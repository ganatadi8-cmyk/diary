'use strict';
const $ = id => document.getElementById(id);
let user = null;
let csrf = '';
let entries = [];
let selectedDate = localDate(new Date());
let viewDate = new Date();
let filterDate = false;
let editingId = null;
let loginMode = true;
let busy = false;
let dirty = false;
let suggestion = null;
let authEpoch = 0;
let loadSequence = 0;
let expiredUserId = null;

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function prettyDate(value) {
  return new Intl.DateTimeFormat(undefined, {day:'numeric', month:'short', year:'numeric'}).format(new Date(value + 'T12:00:00'));
}
function status(message, error = false) {
  $('app-status').textContent = message;
  $('app-status').classList.toggle('error', error);
}
async function api(path, options = {}) {
  const response = await fetch('/api' + path, {
    ...options, credentials: 'same-origin',
    headers: {'Content-Type':'application/json', 'X-CSRF-Token':csrf, ...options.headers},
    signal: AbortSignal.timeout(35000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && user) {
      expiredUserId = user.id;
      user = null; entries = []; authEpoch++;
      renderAuth();
      $('auth-error').textContent = 'Your session expired. Sign in again to continue your writing.';
    }
    const error = new Error(data.error || 'The request could not be completed. Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}
function message(error) {
  return error.name === 'TimeoutError' ? 'The request timed out. Refresh your memories before retrying a save; it may have completed.' :
    error instanceof TypeError ? 'Connection lost. Your text is still here. Refresh your memories before retrying a save.' : error.message;
}
function renderAuth() {
  $('auth-modal').hidden = !!user;
  $('app-content').inert = !user;
  $('user-controls').hidden = !user;
  $('user-view').hidden = !user;
  if (user) {
    $('welcome-msg').textContent = `Hello, ${user.name}`;
    renderCalendar();
    renderEntries();
  }
}
async function connect() {
  $('auth-submit-btn').disabled = true;
  $('retry-connection').hidden = true;
  try {
    const data = await api('/session');
    csrf = data.csrf_token;
    user = data.user;
    authEpoch++;
    renderAuth();
    $('auth-error').textContent = '';
    $('auth-submit-btn').disabled = false;
    $('auth-submit-btn').textContent = loginMode ? 'Sign in' : 'Create account';
    if (user) await loadEntries();
  } catch (error) {
    $('auth-error').textContent = message(error);
    $('auth-submit-btn').textContent = 'Connect to continue';
    $('retry-connection').hidden = false;
  }
}
function setMode(login) {
  loginMode = login;
  $('tab-login').classList.toggle('active', login);
  $('tab-register').classList.toggle('active', !login);
  $('tab-login').setAttribute('aria-pressed', String(login));
  $('tab-register').setAttribute('aria-pressed', String(!login));
  $('auth-submit-btn').textContent = login ? 'Sign in' : 'Create account';
  $('auth-password').autocomplete = login ? 'current-password' : 'new-password';
  $('auth-password').minLength = login ? 1 : 8;
  $('password-help').hidden = login;
  $('auth-error').textContent = '';
}
$('tab-login').onclick = () => setMode(true);
$('tab-register').onclick = () => setMode(false);
$('retry-connection').onclick = connect;
$('auth-form').onsubmit = async event => {
  event.preventDefault();
  $('auth-submit-btn').disabled = true;
  $('tab-login').disabled = $('tab-register').disabled = true;
  try {
    // Refresh the CSRF token before authenticating (also recovers an expired cookie).
    csrf = (await api('/session')).csrf_token;
    const data = await api(loginMode ? '/login' : '/register', {method:'POST', body:JSON.stringify({name:$('auth-name').value.trim(), password:$('auth-password').value})});
    user = {id:data.id, name:data.name};
    if (expiredUserId !== null && expiredUserId !== user.id) resetEditor();
    expiredUserId = null;
    csrf = data.csrf_token;
    authEpoch++;
    $('auth-form').reset();
    $('auth-error').textContent = '';
    renderAuth();
    await loadEntries();
  } catch (error) { $('auth-error').textContent = message(error); }
  finally { $('auth-submit-btn').disabled = false; $('tab-login').disabled = $('tab-register').disabled = false; }
};
$('logout-btn').onclick = async () => {
  if (busy || (dirty && !confirm('Sign out and discard your unsaved writing?'))) return;
  setBusy(true);
  try {
    await api('/logout', {method:'POST'});
    authEpoch++;
    user = null; entries = []; csrf = '';
    resetEditor();
    $('search-input').value = '';
    selectedDate = localDate(new Date()); viewDate = new Date(); filterDate = false;
    $('entries-list').replaceChildren();
    status(''); renderAuth();
    await connect();
  } catch (error) { status(message(error), true); }
  finally { setBusy(false); }
};
async function loadEntries() {
  if (!user) return;
  const epoch = authEpoch;
  const sequence = ++loadSequence;
  status('Loading your memories…');
  try {
    const result = await api('/entries');
    if (epoch !== authEpoch || sequence !== loadSequence) return;
    entries = result;
    renderCalendar(); renderEntries();
    status('Your memories are up to date.');
  } catch (error) {
    if (epoch === authEpoch && sequence === loadSequence) status(message(error), true);
  }
}
function renderCalendar() {
  $('month-year-header').textContent = new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(viewDate);
  $('selected-date-label').textContent = prettyDate(selectedDate);
  $('viewing-date-label').textContent = filterDate ? prettyDate(selectedDate) : 'All dates';
  $('show-all-btn').hidden = !filterDate;
  $('entry-count').textContent = entries.length;
  $('day-count').textContent = new Set(entries.map(e => e.date)).size;
  const container = $('calendar-days'); container.replaceChildren();
  const year = viewDate.getFullYear(), month = viewDate.getMonth();
  for (let i=0; i<new Date(year,month,1).getDay(); i++) {
    const blank = document.createElement('span'); blank.className = 'day-cell empty'; container.append(blank);
  }
  const dates = new Set(entries.map(e=>e.date));
  for (let day=1; day<=new Date(year,month+1,0).getDate(); day++) {
    const date = localDate(new Date(year,month,day));
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'day-cell'; button.textContent = day;
    button.classList.toggle('active', date === selectedDate);
    button.classList.toggle('today', date === localDate(new Date()));
    button.setAttribute('aria-pressed', String(date===selectedDate));
    button.setAttribute('aria-label', prettyDate(date) + (dates.has(date)? ', has entries':''));
    if (dates.has(date)) { const dot = document.createElement('span'); dot.className='day-dot'; button.append(dot); }
    button.onclick = () => chooseDate(date);
    container.append(button);
  }
}
function chooseDate(date) {
  if (busy) return;
  if (editingId && date !== selectedDate && !confirm('Cancel editing this memory and choose another date?')) return;
  if (editingId && date !== selectedDate) resetEditor();
  selectedDate = date; filterDate = true;
  renderCalendar(); renderEntries();
}
$('prev-month').onclick = () => { viewDate = new Date(viewDate.getFullYear(),viewDate.getMonth()-1,1); renderCalendar(); };
$('next-month').onclick = () => { viewDate = new Date(viewDate.getFullYear(),viewDate.getMonth()+1,1); renderCalendar(); };
$('today-btn').onclick = () => { if (busy) return; chooseDate(localDate(new Date())); viewDate = new Date(selectedDate+'T12:00:00'); renderCalendar(); };
$('show-all-btn').onclick = () => { filterDate=false; renderCalendar(); renderEntries(); };
$('refresh-btn').onclick = loadEntries;
$('search-input').oninput = renderEntries;
function renderEntries() {
  const list = $('entries-list'); list.replaceChildren();
  const query = $('search-input').value.trim().toLocaleLowerCase();
  const shown = entries.filter(e => (!filterDate || e.date===selectedDate) && (e.title+' '+e.content).toLocaleLowerCase().includes(query));
  if (!shown.length) {
    const empty = document.createElement('p'); empty.className='empty-state';
    empty.textContent = query ? 'No memories match your search.' : 'Your story starts here. Write a little about your day and save your first memory.';
    list.append(empty); return;
  }
  for (const entry of shown) {
    const card = document.createElement('article'); card.className='entry-card';
    const title = document.createElement('h3'); title.textContent=entry.title;
    const content = document.createElement('p'); content.textContent=entry.content;
    const footer = document.createElement('div'); footer.className='entry-footer';
    const date = document.createElement('time'); date.className='entry-date'; date.dateTime=entry.date; date.textContent=prettyDate(entry.date);
    const actions = document.createElement('div'); actions.className='entry-actions';
    const edit = document.createElement('button'); edit.className='secondary-btn'; edit.textContent='Edit'; edit.onclick=()=>editEntry(entry);
    const remove = document.createElement('button'); remove.className='delete-btn'; remove.textContent='Delete'; remove.onclick=()=>deleteEntry(entry);
    actions.append(edit,remove); footer.append(date,actions); card.append(title,content,footer); list.append(card);
  }
}
function updateWords() {
  const text=$('content').value.trim();
  $('word-count').textContent=`${text ? text.split(/\s+/u).length : 0} words · ${$('content').value.length.toLocaleString()} / 20,000 characters`;
}
function edited() { dirty=true; suggestion=null; $('ai-preview').hidden=true; updateWords(); }
$('title').oninput=edited; $('content').oninput=edited;
function resetEditor() {
  $('diary-form').reset(); editingId=null; dirty=false; suggestion=null;
  $('ai-preview').hidden=true; $('cancel-edit').hidden=true;
  $('date-status-badge').textContent='New entry'; $('save-btn').textContent='Save entry'; updateWords();
}
function editEntry(entry) {
  if (busy || (dirty && !confirm('Discard unsaved writing and edit this memory?'))) return;
  editingId=entry.id; selectedDate=entry.date; viewDate=new Date(entry.date+'T12:00:00');
  $('title').value=entry.title; $('content').value=entry.content;
  dirty=false; suggestion=null; $('ai-preview').hidden=true;
  $('date-status-badge').textContent='Editing'; $('cancel-edit').hidden=false; $('save-btn').textContent='Save changes';
  updateWords(); renderCalendar(); renderEntries(); $('title').focus();
}
$('cancel-edit').onclick=()=>{ if (!busy && (!dirty || confirm('Discard your unsaved changes?'))) resetEditor(); };
$('prompt-btn').onclick=()=>{
  if (busy) return;
  if ($('content').value && !confirm('Replace your current text with the writing prompt?')) return;
  $('content').value='One small thing I want to remember about today is ';
  edited(); $('content').focus();
};
function setBusy(value) {
  busy=value;
  for (const id of ['save-btn','ai-agent-btn','title','content','logout-btn','cancel-edit','refresh-btn','apply-ai','dismiss-ai']) $(id).disabled=value;
}
$('diary-form').onsubmit=async event=>{
  event.preventDefault(); if (busy) return;
  const body={title:$('title').value.trim(),content:$('content').value.trim(),date:selectedDate};
  if (!body.title || !body.content) { status('Add a title and some thoughts before saving.',true); return; }
  setBusy(true); ++loadSequence; status('Saving your memory…');
  try {
    const saved=await api('/entries'+(editingId?'/'+editingId:''),{method:editingId?'PUT':'POST',body:JSON.stringify(body)});
    entries=entries.filter(e=>e.id!==saved.id); entries.push(saved);
    entries.sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id-a.id);
    resetEditor(); renderCalendar(); renderEntries(); status('Saved to your diary.');
  } catch(error){ status(message(error),true); }
  finally{setBusy(false);}
};
async function deleteEntry(entry) {
  if (busy || !confirm(`Permanently delete “${entry.title}”?`)) return;
  setBusy(true); ++loadSequence;
  try {
    await api('/entries/'+entry.id,{method:'DELETE'});
    entries=entries.filter(e=>e.id!==entry.id);
    if(editingId===entry.id) resetEditor();
    renderCalendar(); renderEntries(); status('Entry deleted.');
  } catch(error){status(message(error),true);}
  finally{setBusy(false);}
}
$('export-btn').onclick=async()=>{
  $('export-btn').disabled=true;
  try {
    const data=await api('/export');
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link=document.createElement('a'); link.href=url; link.download='my-diary-'+localDate(new Date())+'.json';
    document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    status('Diary exported. Keep the downloaded file private.');
  }catch(error){status(message(error),true);}
  finally{$('export-btn').disabled=false;}
};
$('ai-agent-btn').onclick=async()=>{
  if(busy) return;
  if(!$('content').value.trim()){status('Write something first to get a suggestion.',true);return;}
  setBusy(true); status('Preparing a writing suggestion…');
  try {
    suggestion=await api('/ai-agent',{method:'POST',body:JSON.stringify({title:$('title').value,content:$('content').value})});
    $('ai-preview-title').textContent=suggestion.rectified_title;
    $('ai-preview-content').textContent=suggestion.rectified_content;
    $('ai-preview').hidden=false; status('Review the suggestion. Your original text is unchanged.');
  }catch(error){status(message(error),true);}
  finally{setBusy(false);}
};
$('apply-ai').onclick=()=>{
  if(!suggestion || busy) return;
  $('title').value=suggestion.rectified_title; $('content').value=suggestion.rectified_content;
  edited(); status('Suggestion applied. Save your entry when you are ready.');
};
$('dismiss-ai').onclick=()=>{suggestion=null;$('ai-preview').hidden=true;};
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
// Authentication comes from the server, never from editable browser storage.
try { localStorage.removeItem('user'); } catch (_) { /* Storage may be disabled. */ }
connect();
