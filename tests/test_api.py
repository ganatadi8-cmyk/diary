import os
import sqlite3
from datetime import timedelta

import pytest
from sqlalchemy import select
from werkzeug.security import check_password_hash
from backend.app import Entry, LoginSession, User, create_app, db, normalize_database_url, utcnow


@pytest.fixture
def app(tmp_path):
    url = os.getenv('TEST_DATABASE_URL')
    if url:
        assert url.split('?')[0].endswith('/diary_test'), 'Use a dedicated diary_test database only.'
    application = create_app({'TESTING': True, 'SECRET_KEY': 'test-secret',
                              'SQLALCHEMY_DATABASE_URI': normalize_database_url(url) if url else f'sqlite:///{tmp_path / "test.db"}',
                              'SESSION_COOKIE_SECURE': False, 'GEMINI_API_KEY': None})
    with application.app_context():
        db.drop_all()
        db.create_all()
    yield application
    with application.app_context():
        db.session.remove()
        db.drop_all()
        db.engine.dispose()


def write(client, path, data=None, method='POST', **kwargs):
    csrf = client.get('/api/session').json['csrf_token']
    return client.open('/api' + path, method=method, json=data, headers={'X-CSRF-Token': csrf}, **kwargs)


def register(client, name='Alice'):
    response = write(client, '/register', {'name': name, 'password': 'safe-pass-123'})
    assert response.status_code == 201, response.json
    return response.json


def entry(client, **changes):
    return write(client, '/entries', {'title': 'A good day', 'content': 'తెలుగులో నా రోజు 🌿', 'date': '2026-09-21', **changes})


def test_passwords_cookie_and_csrf(app):
    client = app.test_client()
    register(client)
    with app.app_context():
        user = db.session.scalar(select(User))
        assert user.password != 'safe-pass-123'
        assert check_password_hash(user.password, 'safe-pass-123')
    cookie = client.get_cookie('session')
    assert cookie.http_only and cookie.same_site == 'Lax'
    assert client.post('/api/entries', json={}).status_code == 403
    assert client.get('/api/entries').headers['Cache-Control'] == 'no-store'


def test_header_impersonation_and_private_crud(app):
    alice, bob, guest = [app.test_client() for _ in range(3)]
    a = register(alice)
    saved = entry(alice).json
    register(bob, 'Bob')
    assert guest.get('/api/entries', headers={'X-User-Id': str(a['id'])}).status_code == 401
    assert bob.get('/api/entries', headers={'X-User-Id': str(a['id'])}).json == []
    assert write(bob, f'/entries/{saved["id"]}', {}, 'PUT').status_code == 404
    assert write(bob, f'/entries/{saved["id"]}', method='DELETE').status_code == 404
    assert bob.get('/api/export').json['entries'] == []
    updated = write(alice, f'/entries/{saved["id"]}', {'title':'Edited', 'content':'Still private', 'date':'2026-09-20'}, 'PUT')
    assert updated.status_code == 200
    assert updated.json['date'] == '2026-09-20'
    assert alice.get('/api/export').json['entries'][0]['title'] == 'Edited'
    assert write(alice, f'/entries/{saved["id"]}', method='DELETE').status_code == 200
    assert alice.get('/api/entries').json == []


def test_roles_cannot_read_other_diaries(app):
    alice, admin = app.test_client(), app.test_client()
    register(alice)
    entry(alice)
    admin_id = register(admin, 'FormerAdmin')['id']
    with app.app_context():
        db.session.get(User, admin_id).role = 'admin'
        db.session.commit()
    assert admin.get('/api/entries').json == []


def test_login_logout_revokes_copied_cookie(app):
    client = app.test_client()
    register(client)
    copied = client.get_cookie('session').value
    assert write(client, '/logout').status_code == 200
    client.set_cookie('session', copied)
    assert client.get('/api/entries').status_code == 401
    assert write(client, '/login', {'name':'Alice','password':'wrong'}).status_code == 401
    assert write(client, '/login', {'name':'Alice','password':'safe-pass-123'}).status_code == 200


def test_session_expiry(app):
    client = app.test_client()
    register(client)
    with app.app_context():
        db.session.scalar(select(LoginSession)).expires_at = utcnow() - timedelta(seconds=1)
        db.session.commit()
    assert client.get('/api/entries').status_code == 401
    assert client.get('/api/session').json['user'] is None


@pytest.mark.parametrize('changes', [{'title':' '}, {'content': ''}, {'title': ['bad']}, {'content':3}, {'date':'2026-02-30'}, {'date':'2026-2-01'}, {'title':'x'*101}, {'content':'x'*20001}])
def test_invalid_entries_are_not_saved(app, changes):
    client = app.test_client(); register(client)
    assert entry(client, **changes).status_code == 400
    assert client.get('/api/entries').json == []


def test_invalid_json_and_duplicate_account(app):
    client = app.test_client(); register(client)
    assert write(client, '/entries', []).status_code == 400
    assert write(client, '/register', {'name':'Alice','password':'safe-pass-123'}).status_code == 409
    assert write(client, '/register', {'name':'Bob','password':'short'}).status_code == 400
    assert entry(client).status_code == 201  # rollback leaves session usable


def test_auth_throttle_is_shared_between_clients(app):
    for _ in range(15):
        assert write(app.test_client(), '/login', {'name':'Missing','password':'wrong'}).status_code == 401
    assert write(app.test_client(), '/login', {'name':'Missing','password':'wrong'}).status_code == 429


def test_persistence_across_app_restart(tmp_path):
    settings = {'TESTING':True, 'SECRET_KEY':'persistent-test-secret',
                'SQLALCHEMY_DATABASE_URI':f'sqlite:///{tmp_path / "persistent.db"}', 'SESSION_COOKIE_SECURE':False}
    first = create_app(settings)
    with first.app_context(): db.create_all()
    client = first.test_client(); register(client); entry(client)
    cookie = client.get_cookie('session').value
    with first.app_context(): db.session.remove(); db.engine.dispose()
    second = create_app(settings)
    returned = second.test_client(); returned.set_cookie('session',cookie)
    assert returned.get('/api/entries').json[0]['content'] == 'తెలుగులో నా రోజు 🌿'


def test_ai_requires_auth_and_configuration(app):
    client = app.test_client()
    assert write(client, '/ai-agent', {'title':'Title','content':'Hello'}).status_code == 401
    register(client)
    assert write(client, '/ai-agent', {'title':'Title','content':'Hello'}).status_code == 503


def test_ai_preview_and_provider_failure(app, monkeypatch):
    import httpx
    app.config['GEMINI_API_KEY'] = 'test-provider-key'
    client = app.test_client(); register(client)
    def provider(*args, **kwargs):
        return httpx.Response(200, request=httpx.Request('POST','https://example.test'), json={'candidates':[{'content':{'parts':[{'text':'{"title":"Hello", "content":"Translated text"}'}]}}]})
    monkeypatch.setattr(httpx, 'post', provider)
    response = write(client, '/ai-agent', {'title':'Title','content':'Original'})
    assert response.status_code == 200 and response.json['rectified_content'] == 'Translated text'
    assert client.get('/api/entries').json == []  # suggestions never save automatically
    monkeypatch.setattr(httpx, 'post', lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError('provider secret')))
    response = write(client, '/ai-agent', {'title':'Title','content':'Original'})
    assert response.status_code == 502 and 'provider secret' not in response.text


def test_production_fails_without_persistent_database(monkeypatch):
    monkeypatch.setenv('APP_ENV','production')
    monkeypatch.setenv('SECRET_KEY','x'*64)
    monkeypatch.setenv('DATABASE_URL','sqlite:////tmp/diary.db')
    with pytest.raises(RuntimeError, match='PostgreSQL'): create_app()
    monkeypatch.setenv('DATABASE_URL','postgresql://example:example@localhost/diary')
    monkeypatch.setenv('SECRET_KEY','short')
    with pytest.raises(RuntimeError, match='SECRET_KEY'): create_app()


def legacy_file(tmp_path, broken=False):
    path = tmp_path / 'legacy.db'
    with sqlite3.connect(path) as connection:
        connection.executescript('CREATE TABLE user(id INTEGER, name TEXT, password TEXT); CREATE TABLE entry(id INTEGER, title TEXT, content TEXT, created_at TEXT, user_id INTEGER);')
        connection.execute('INSERT INTO user VALUES (42, ?, ?)',('Legacy','old-password'))
        connection.execute('INSERT INTO entry VALUES (1, ?, ?, ?, ?)',('Old title','Old memory','2025-05-06 10:00:00',999 if broken else 42))
    return path


def test_legacy_import_and_password_reset(app, tmp_path):
    source = legacy_file(tmp_path)
    result = app.test_cli_runner().invoke(args=['import-sqlite',str(source)])
    assert result.exit_code == 0, result.output
    client = app.test_client()
    assert write(client,'/login',{'name':'Legacy','password':'old-password'}).status_code == 200
    assert client.get('/api/entries').json[0]['content'] == 'Old memory'
    assert app.test_cli_runner().invoke(args=['import-sqlite',str(source)]).exit_code != 0
    result = app.test_cli_runner().invoke(args=['reset-password','Legacy'], input='new-password-123\nnew-password-123\n')
    assert result.exit_code == 0, result.output
    assert client.get('/api/entries').status_code == 401
    assert write(client,'/login',{'name':'Legacy','password':'new-password-123'}).status_code == 200
    with sqlite3.connect(source) as connection:
        assert connection.execute('SELECT password FROM user').fetchone()[0] == 'old-password'


def test_import_rolls_back_on_invalid_source(app, tmp_path):
    result = app.test_cli_runner().invoke(args=['import-sqlite',str(legacy_file(tmp_path,broken=True))])
    assert result.exit_code != 0
    with app.app_context():
        assert db.session.scalar(select(User.id)) is None
        assert db.session.scalar(select(Entry.id)) is None


def test_schema_init_is_repeatable_and_health(app):
    client = app.test_client(); register(client); entry(client)
    assert app.test_cli_runner().invoke(args=['init-db']).exit_code == 0
    assert len(client.get('/api/entries').json) == 1
    assert client.get('/api/health').status_code == 200
    assert client.get('/').status_code == 200
