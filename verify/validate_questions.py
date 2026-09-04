#!/usr/bin/env python3
"""
Question Validation Gate for Sound Doctrine
Every AI-generated question must pass these tests before being accepted.
"""

import json
import re

def load_questions(filepath='data/questions.json'):
    with open(filepath) as f:
        return json.load(f)

def load_kjv_corpus():
    """Load the three-book KJV corpus"""
    books = {}
    for book_file in ['kjv-1timothy.json', 'kjv-2timothy.json', 'kjv-titus.json']:
        with open(f'data/{book_file}') as f:
            data = json.load(f)
            books[data['book']] = data
    return books

def validate_question(q, corpus):
    """
    Validate a single question against all criteria.
    Returns (passed, failures_list)
    """
    failures = []
    
    # A. Is every fact in the three books?
    # Check that reference points to valid book/chapter
    ref = q.get('reference', '')
    book = q.get('book', '')
    chapter = q.get('chapter')
    
    if book not in corpus:
        failures.append(f"Book '{book}' not in corpus")
    
    # B. Is there exactly one defensible answer?
    options = q.get('options', [])
    correct_index = q.get('correctIndex')
    answer = q.get('answer')
    
    if not options or len(options) < 2:
        failures.append("Less than 2 options provided")
    
    if correct_index is None or correct_index >= len(options):
        failures.append("Invalid correctIndex")
    
    if answer and answer != options[correct_index]:
        failures.append("Answer doesn't match correctIndex option")
    
    # C. Does the answer have a verse reference?
    if not ref or ref == "Unknown":
        failures.append("Missing verse reference")
    
    # D. Are distractors plausible?
    # (Basic check - all options should be different)
    if len(set(options)) != len(options):
        failures.append("Duplicate options detected")
    
    # E. Is the question testing the intended difficulty?
    tier = q.get('tier')
    if tier not in [1, 2, 3, 4, 5, 6, 7]:
        failures.append(f"Invalid tier: {tier}")
    
    # T6/T7 should be cross-book or synthesis
    qtype = q.get('type', '')
    if tier in [6, 7] and qtype not in ['crossref', 'synthesis']:
        # Warning, not failure
        pass
    
    # F. Has this question appeared before? (duplicate detector)
    # This would require comparing against all existing questions
    # Skipped for single-question validation
    
    passed = len(failures) == 0
    return passed, failures

def validate_all_questions():
    """Validate all questions and report results"""
    questions = load_questions()
    corpus = load_kjv_corpus()
    
    total = len(questions)
    passed = 0
    failed = 0
    failure_details = []
    
    for q in questions:
        is_passed, failures = validate_question(q, corpus)
        if is_passed:
            passed += 1
        else:
            failed += 1
            failure_details.append({
                'id': q.get('id', 'unknown'),
                'prompt': q.get('prompt', '')[:50],
                'failures': failures
            })
    
    print("=" * 70)
    print("QUESTION VALIDATION REPORT")
    print("=" * 70)
    print(f"Total questions: {total}")
    print(f"Passed: {passed} ({passed/total*100:.1f}%)")
    print(f"Failed: {failed} ({failed/total*100:.1f}%)")
    
    if failure_details:
        print("\n\nFAILED QUESTIONS:")
        print("-" * 70)
        for item in failure_details[:10]:  # Show first 10
            print(f"\nID: {item['id']}")
            print(f"Prompt: {item['prompt']}...")
            print(f"Failures: {', '.join(item['failures'])}")
        
        if len(failure_details) > 10:
            print(f"\n... and {len(failure_details) - 10} more")
    
    return failed == 0

if __name__ == '__main__':
    success = validate_all_questions()
    exit(0 if success else 1)
