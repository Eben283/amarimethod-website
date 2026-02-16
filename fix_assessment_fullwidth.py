#!/usr/bin/env python3
"""
Move the assessment banner outside the article tag to make it full-width.
"""

import re
import os

# List of all blog HTML files
blog_files = [
    'blog-active-bridge-strength.html',
    'blog-elbow-reset-tennis-elbow.html',
    'blog-hand-balancer-carpal-tunnel.html',
    'blog-jaw-align-tmj-relief.html',
    'blog-passive-bridge-mobility.html',
    'blog-power-posture-shoulder-blades.html',
    'blog-putting-it-all-together.html',
    'blog-spinal-wave-gentle-decompression.html',
    'blog-spring-step-calf-ankle.html',
    'blog-suspension-squat-hanging-exercises.html',
    'blog-vertical-drop-spine-decompression.html'
]

# Process each blog file
for filename in blog_files:
    filepath = f'/Users/Eben/Desktop/my-new-website/{filename}'

    if not os.path.exists(filepath):
        print(f"⚠️  File not found: {filename}")
        continue

    # Read the file
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Pattern to find: assessment-section through end of section, followed by related-articles and </article>
    # We need to extract the assessment banner and move it after </article>

    # Find the assessment section
    assessment_pattern = r'(\s*<!-- Assessment Banner -->.*?</section>)\s*(\s*<div class="related-articles">.*?</div>)\s*(</article>)'

    match = re.search(assessment_pattern, content, re.DOTALL)

    if match:
        assessment_section = match.group(1)  # The assessment banner
        related_articles = match.group(2)     # The related articles
        article_close = match.group(3)        # </article> tag

        # Reconstruct: related articles, close article, then assessment banner (full width)
        replacement = f'{related_articles}\n{article_close}\n{assessment_section}'

        # Replace in content
        new_content = content[:match.start()] + replacement + content[match.end():]

        # Write the updated content
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)

        print(f"✅ {filename} - Assessment banner moved to full-width position")
    else:
        print(f"⚠️  {filename} - Could not find assessment banner pattern")

print("\n✨ Full-width assessment banner update complete!")
