#!/usr/bin/env python3
"""
Add the compact assessment banner to all blog pages before the Related Articles section.
"""

import re
import os

# The compact assessment banner HTML
assessment_banner = '''
    <!-- Assessment Banner -->
    <section class="section assessment-section" style="background: #F6F3E8; padding: 3.5rem 2rem;">
        <div class="container">
            <div class="section-two-col assessment-content" style="gap: 2.5rem; align-items: center;">
                <div class="assessment-image-wrapper" style="width: 100%; max-width: 280px;">
                    <div class="assessment-image-frame">
                        <img src="images/Quiz cover image.avif" alt="Body Balance Assessment Quiz" style="width: 100%; border-radius: 16px; display: block;" loading="lazy">
                    </div>
                </div>
                <div class="assessment-text">
                    <span class="assessment-label" style="display: inline-block; color: var(--color-primary); font-size: 0.85rem; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 0.75rem;">Quick Assessment</span>
                    <h2 style="font-size: 2.2rem; margin-bottom: 1rem; font-weight: 700; line-height: 1.3;">Discover What's Really Causing Your Pain</h2>
                    <p style="margin-bottom: 1.25rem; font-size: 1.05rem; line-height: 1.7; color: #666; margin-top: 0;">
                        Take our 2-minute Body Balance Assessment to reveal the hidden patterns behind your pain that most treatments miss. Get personalized insights and discover your path to relief.
                    </p>
                    <div class="assessment-features" style="margin-bottom: 1.75rem;">
                        <div style="display: flex; align-items: center; margin-bottom: 0.75rem;">
                            <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: white; color: #1a1a1a; border-radius: 50%; font-weight: 700; margin-right: 10px; font-size: 0.85rem; flex-shrink: 0; border: 2px solid #e0e0e0;">✓</span>
                            <span style="color: #555; font-size: 0.95rem;">Takes just 2 minutes to complete</span>
                        </div>
                        <div style="display: flex; align-items: center; margin-bottom: 0.75rem;">
                            <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: white; color: #1a1a1a; border-radius: 50%; font-weight: 700; margin-right: 10px; font-size: 0.85rem; flex-shrink: 0; border: 2px solid #e0e0e0;">✓</span>
                            <span style="color: #555; font-size: 0.95rem;">Personalized insights delivered instantly</span>
                        </div>
                        <div style="display: flex; align-items: center;">
                            <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: white; color: #1a1a1a; border-radius: 50%; font-weight: 700; margin-right: 10px; font-size: 0.85rem; flex-shrink: 0; border: 2px solid #e0e0e0;">✓</span>
                            <span style="color: #555; font-size: 0.95rem;">No email or commitment required</span>
                        </div>
                    </div>
                    <button class="btn-secondary" style="box-shadow: none;" onclick="window.open('https://quiz.amarimethod.com/', '_blank')"><span class="btn-content"><span class="arrow">→</span><span class="btn-text">Start Your Assessment</span></span></button>
                </div>
            </div>
        </div>
    </section>
'''

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

    # Check if assessment banner already exists
    if 'assessment-section' in content:
        print(f"⏭️  {filename} - Assessment banner already exists, skipping")
        continue

    # Find the Related Articles section and insert the banner before it
    # Look for the related-articles div
    pattern = r'(\s*<div class="related-articles">)'

    match = re.search(pattern, content)

    if match:
        # Insert the assessment banner before the Related Articles div
        new_content = content[:match.start()] + assessment_banner + content[match.start():]

        # Write the updated content
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)

        print(f"✅ {filename} - Assessment banner added")
    else:
        print(f"⚠️  {filename} - Could not find Related Articles section")

print("\n✨ Assessment banner addition complete!")
