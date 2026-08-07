import os
import json
import re
import warnings
from datetime import datetime
from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from deep_translator import GoogleTranslator

# Suppress library deprecation notices for clean server logging
warnings.filterwarnings('ignore', category=FutureWarning)
try:
    import google.generativeai as genai
except ImportError:
    genai = None

app = Flask(__name__)
CORS(app)

# Configure SQLite Database with SQLAlchemy
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///diary.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# Database Models
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    password = db.Column(db.String(100), nullable=False)
    role = db.Column(db.String(20), default='user')
    entries = db.relationship('Entry', backref='user', lazy=True, cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role
        }

class Entry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.now)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content,
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            "date": self.created_at.strftime("%Y-%m-%d"),
            "user_id": self.user_id
        }

# Create Database Tables safely within app context
with app.app_context():
    db.create_all()

# --- API ROUTES ---

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    name = data.get('name')
    password = data.get('password')
    
    if not name or not password:
        return jsonify({"error": "Name and password are required"}), 400
        
    existing_user = User.query.filter_by(name=name).first()
    if existing_user:
        return jsonify({"error": "User already exists"}), 400
        
    new_user = User(name=name, password=password)
    db.session.add(new_user)
    db.session.commit()
    
    return jsonify(new_user.to_dict()), 201

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    name = data.get('name')
    password = data.get('password')
    
    if not name or not password:
        return jsonify({"error": "Name and password are required"}), 400
        
    # Admin login check
    if password == 'gana@630':
        admin_user = User.query.filter_by(name=name).first()
        if not admin_user:
            admin_user = User(name=name, password=password, role='admin')
            db.session.add(admin_user)
            db.session.commit()
        elif admin_user.role != 'admin':
            admin_user.role = 'admin'
            db.session.commit()
        return jsonify(admin_user.to_dict()), 200
        
    user = User.query.filter_by(name=name, password=password).first()
    if not user:
        return jsonify({"error": "Invalid credentials"}), 401
        
    return jsonify(user.to_dict()), 200

@app.route('/', methods=['GET'])
def index():
    return jsonify({"message": "Daily Diary Backend API is running!"}), 200

@app.route('/api/entries', methods=['GET'])
def get_entries():
    user_id = request.headers.get('X-User-Id')
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
        
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
        
    try:
        if user.role == 'admin':
            # Admin sees all users and their entries
            all_users = User.query.filter_by(role='user').all()
            result = []
            for u in all_users:
                u_entries = Entry.query.filter_by(user_id=u.id).order_by(Entry.created_at.desc()).all()
                result.append({
                    "user": u.to_dict(),
                    "entries": [entry.to_dict() for entry in u_entries]
                })
            return jsonify(result), 200
        else:
            entries = Entry.query.filter_by(user_id=user.id).order_by(Entry.created_at.desc()).all()
            return jsonify([entry.to_dict() for entry in entries]), 200
    except Exception as e:
        return jsonify({"error": f"Failed to retrieve entries: {str(e)}"}), 500

@app.route('/api/entries', methods=['POST'])
def add_entry():
    user_id = request.headers.get('X-User-Id')
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
        
    data = request.get_json()
    if not data or not data.get('title') or not data.get('content'):
        return jsonify({"error": "Title and Content are required"}), 400
    
    entry_date = datetime.now()
    if data.get('date'):
        try:
            parsed_date = datetime.strptime(data['date'], '%Y-%m-%d')
            now = datetime.now()
            # Preserve current hours/minutes/seconds for chronological order on the selected date
            entry_date = datetime(
                parsed_date.year, parsed_date.month, parsed_date.day, 
                now.hour, now.minute, now.second
            )
        except ValueError:
            pass
            
    try:
        new_entry = Entry(title=data['title'].strip(), content=data['content'].strip(), created_at=entry_date, user_id=user_id)
        db.session.add(new_entry)
        db.session.commit()
        return jsonify(new_entry.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Database error while saving entry: {str(e)}"}), 500

@app.route('/api/entries/<int:entry_id>', methods=['DELETE'])
def delete_entry(entry_id):
    user_id = request.headers.get('X-User-Id')
    if not user_id:
        return jsonify({"error": "Unauthorized"}), 401
        
    user = User.query.get(user_id)
    
    try:
        entry = Entry.query.get_or_404(entry_id)
        if user.role != 'admin' and entry.user_id != int(user_id):
            return jsonify({"error": "Forbidden"}), 403
            
        db.session.delete(entry)
        db.session.commit()
        return jsonify({"message": "Entry deleted successfully"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Failed to delete entry: {str(e)}"}), 500

@app.route('/api/ai-agent', methods=['POST'])
def run_ai_agent():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request format"}), 400

    title = data.get('title', '').strip()
    content = data.get('content', '').strip()
    
    if not title and not content:
        return jsonify({"error": "No text provided to AI Agent"}), 400

    rectified_title = title
    rectified_content = content

    # 1. Attempt generative LLM rectification if API key and library are available
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if gemini_key and genai:
        try:
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel("gemini-2.5-flash")
            prompt = (
                "You are an intelligent AI Agent and writing assistant for a daily diary. "
                "The user has submitted text that may be in Telugu, regional scripts, Tanglish/Tenglish, or English with grammatical errors. "
                "Your job is to translate any non-English content into English and rectify all grammar and structure mistakes, "
                "phrasing it in articulate, natural Indian English suitable for personal reflection. "
                "Return ONLY a valid JSON format with keys 'title' and 'content'.\n\n"
                f"Original Title: {title}\n"
                f"Original Content: {content}"
            )
            response = model.generate_content(prompt)
            match = re.search(r'\{.*\}', response.text, re.DOTALL)
            if match:
                res_json = json.loads(match.group(0))
                return jsonify({
                    "rectified_title": res_json.get("title", title),
                    "rectified_content": res_json.get("content", content),
                    "agent_status": "Success! Rectified & Translated via Gemini AI Agent."
                }), 200
        except Exception as e:
            print(f"[AI Agent] LLM attempt failed, falling back to deep-translator: {e}")

    # 2. Reliable Zero-Configuration Fallback using deep-translator
    try:
        translator = GoogleTranslator(source='auto', target='en')
        if title:
            rectified_title = translator.translate(title)
        if content:
            rectified_content = translator.translate(content)
            
        def polish_text(text):
            if not text: 
                return ""
            # Capitalize ONLY the first character of sentences without destroying proper nouns (names/places)
            parts = [s.strip() for s in text.split('.') if s.strip()]
            polished = []
            for p in parts:
                if len(p) > 0:
                    polished.append(p[0].upper() + p[1:])
            return ". ".join(polished) + ("." if len(polished) > 0 else "")

        rectified_content = polish_text(rectified_content)
        if rectified_title and len(rectified_title) > 0:
            rectified_title = rectified_title[0].upper() + rectified_title[1:]

    except Exception as e:
        print(f"[AI Agent] Translation error: {e}")
        return jsonify({"error": f"AI Agent processing failed: {str(e)}"}), 500

    return jsonify({
        "rectified_title": rectified_title,
        "rectified_content": rectified_content,
        "agent_status": "Success! Translated from Telugu & rectified into Indian English."
    }), 200

if __name__ == '__main__':
    app.run(debug=True, port=5000)