"""
Flask API for semantic merge assistant backend.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from merge_assistant import MergeAssistant

app = Flask(__name__)
CORS(app)

assistant = MergeAssistant(config_dir=os.path.join(os.path.dirname(__file__), '..', 'data'))

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})

@app.route('/api/diff', methods=['POST'])
def get_diff():
    """Get diff between two versions"""
    data = request.json
    base = data.get('base', '')
    modified = data.get('modified', '')
    
    try:
        diff = assistant.get_diff(base, modified)
        return jsonify(diff)
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/merge-suggestions', methods=['POST'])
def merge_suggestions():
    """Get merge suggestions for three versions"""
    data = request.json
    base = data.get('base', '')
    ours = data.get('ours', '')
    theirs = data.get('theirs', '')
    use_lora = data.get('use_lora', True)
    
    try:
        suggestions = assistant.get_merge_suggestions(base, ours, theirs, use_lora)
        return jsonify({'suggestions': suggestions})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/merge-conflicts', methods=['POST'])
def merge_conflicts():
    """Detect merge conflicts"""
    data = request.json
    base = data.get('base', '')
    ours = data.get('ours', '')
    theirs = data.get('theirs', '')
    
    try:
        conflicts = assistant.detect_conflicts(base, ours, theirs)
        return jsonify({'conflicts': conflicts})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/learn', methods=['POST'])
def learn_choice():
    """Learn from user's merge choice"""
    data = request.json
    suggestion = data.get('suggestion', {})
    accepted = data.get('accepted', True)
    
    try:
        assistant.learn_from_choice(suggestion, accepted)
        return jsonify({'status': 'ok'})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

if __name__ == '__main__':
    app.run(debug=False, port=5000)
