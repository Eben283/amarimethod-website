#!/usr/bin/env python3
"""
Comprehensive fix for blog post related article links:
1. Remove top "Back to Free Resources" link
2. Remove inline CSS causing underlines
3. Reorganize related article links with proper mapping
4. Add "Back to Free Resources" as 4th link at bottom
"""

import re
import os

# Mapping of blog posts to their 3 related articles + back link
link_mapping = {
    'blog-active-bridge-strength.html': [
        ('blog-passive-bridge-mobility.html', 'Passive Bridge Exercise: Restore Spinal Mobility and Release Deep Tension'),
        ('blog-suspension-squat-hanging-exercises.html', 'Suspension Squat Hanging Exercises: Transform Your Body Alignment'),
        ('blog-putting-it-all-together.html', 'Putting It All Together: Your Personalized Amari Method Practice'),
        ('blog.html', 'Back to Free Resources')
    ],
    'blog-elbow-reset-tennis-elbow.html': [
        ('blog-hand-balancer-carpal-tunnel.html', 'Hand Balancer Exercise: Eliminate Carpal Tunnel and Hand Pain'),
        ('blog-power-posture-shoulder-blades.html', 'Power Posture Exercise: Fix Forward Head Posture'),
        ('blog-suspension-squat-hanging-exercises.html', 'Suspension Squat Hanging Exercises: Transform Your Body Alignment'),
        ('blog.html', 'Back to Free Resources')
    ],
    'blog-hand-balancer-carpal-tunnel.html': [
        ('blog-elbow-reset-tennis-elbow.html', 'Elbow Reset Exercise: Eliminate Tennis Elbow and Golfer\'s Elbow'),
        ('blog-power-posture-shoulder-blades.html', 'Power Posture Exercise: Fix Forward Head Posture'),
        ('blog-suspension-squat-hanging-exercises.html', 'Suspension Squat Hanging Exercises: Transform Your Body Alignment'),
        ('blog.html', 'Back to Free Resources')
    ],
    'blog-jaw-align-tmj-relief.html': [
        ('blog-power-posture-shoulder-blades.html', 'Power Posture Exercise: Fix Forward Head Posture'),
        ('blog-hand-balancer-carpal-tunnel.html', 'Hand Balancer Exercise: Eliminate Carpal Tunnel and Hand Pain'),
        ('blog-putting-it-all-together.html', 'Putting It All Together: Your Personalized Amari Method Practice'),
        ('blog.html', 'Back to Free Resources')
    ],
    'blog-passive-bridge-mobility.html': [
        ('blog-active-bridge-strength.html', 'Active Bridge Exercise: Build Spinal Strength and Stabilize Loose Joints'),
        ('blog-spinal-wave-gentle-decompression.html', 'Spinal Wave Exercise: Gentle Spinal Decompression'),
        ('blog-vertical-drop-spine-decompression.html', 'Vertical Drop Exercise: Decompress Your Spine'),
        ('blog.html', 'Back to Free Resources')
    ],
    'blog-power-posture-shoulder-blades.html': [
        ('blog-suspension-squat-hanging-exercises.html', 'Suspension Squat Hanging Exercises: Transform Your Body Alignment'),
        ('blog-hand-balancer-carpal-tunnel.html', 'Hand Balancer Exercise: Eliminate Carpal Tunnel and Hand Pain'),
        ('blog-jaw-align-tmj-relief.html', 'Jaw Align Exercise: Reverse TMJ Disorder Naturally'),
        ('blog.html', 'Back to Free Resources')
    ],
    'blog-putting-it-all-together.html': [
        ('blog-suspension-squat-hanging-exercises.html', 'Suspension Squat Hanging Exercises: Transform Your Body Alignment'),
        ('blog-passive-bridge-mobility.html', 'Passive Bridge Exercise: Restore Spinal Mobility'),
        ('blog-active-bridge-strength.html', 'Active Bridge Exercise: Build Spinal Strength'),
        ('blog.html', 'Back to Free Resources')
    ],
    'blog-spinal-wave-gentle-decompression.html': [
        ('blog-passive-bridge-mobility.html', 'Passive Bridge Exercise: Restore Spinal Mobility'),
        ('blog-vertical-drop-spine-decompression.html', 'Vertical Drop Exercise: Decompress Your Spine'),
        ('blog-spring-step-calf-ankle.html', 'Spring Step Exercise: Calf and Ankle Decompression'),
        ('blog.html', 'Back to Free Resources')
    ],
    'blog-spring-step-calf-ankle.html': [
        ('blog-spinal-wave-gentle-decompression.html', 'Spinal Wave Exercise: Gentle Spinal Decompression'),
        ('blog-vertical-drop-spine-decompression.html', 'Vertical Drop Exercise: Decompress Your Spine'),
        ('blog-suspension-squat-hanging-exercises.html', 'Suspension Squat Hanging Exercises: Transform Your Body Alignment'),
        ('blog.html', 'Back to Free Resources')
    ],
    'blog-suspension-squat-hanging-exercises.html': [
        ('blog-power-posture-shoulder-blades.html', 'Power Posture Exercise: Fix Forward Head Posture'),
        ('blog-vertical-drop-spine-decompression.html', 'Vertical Drop Exercise: Decompress Your Spine'),
        ('blog-spinal-wave-gentle-decompression.html', 'Spinal Wave Exercise: Gentle Spinal Decompression'),
        ('blog.html', 'Back to Free Resources')
    ],
    'blog-vertical-drop-spine-decompression.html': [
        ('blog-suspension-squat-hanging-exercises.html', 'Suspension Squat Hanging Exercises: Transform Your Body Alignment'),
        ('blog-passive-bridge-mobility.html', 'Passive Bridge Exercise: Restore Spinal Mobility'),
        ('blog-power-posture-shoulder-blades.html', 'Power Posture Exercise: Fix Forward Head Posture'),
        ('blog.html', 'Back to Free Resources')
    ]
}

# Process each blog file
for filename, links in link_mapping.items():
    filepath = f'/Users/Eben/Desktop/my-new-website/{filename}'

    if not os.path.exists(filepath):
        print(f"⚠️  File not found: {filename}")
        continue

    # Read the file
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original_content = content

    # Step 1: Remove top "Back to Free Resources" link (lines ~295-297)
    # Pattern: <div style="max-width: 800px; margin: 2rem auto 0; padding: 0 1.5rem;">
    #              <a href="blog.html" class="btn-tertiary"...>← Back to Free Resources</a>
    #          </div>
    top_link_pattern = r'<div style="max-width: 800px[^>]*>[\s\n]*<a href="blog\.html"[^>]*>.*?Back to Free Resources.*?</a>[\s\n]*</div>'
    content = re.sub(top_link_pattern, '', content, flags=re.DOTALL)

    # Step 2: Remove inline CSS block for .related-articles (lines ~159-202)
    # This removes the entire CSS block that adds underline on hover
    css_pattern = r'\.related-articles \{[\s\S]*?\.related-articles a:hover \{[\s\S]*?\}'
    content = re.sub(css_pattern, '', content)

    # Step 3: Update related articles section with new links
    # Find the related-articles div
    related_pattern = r'(<div class="related-articles">[\s\n]*<h2>Related Articles</h2>[\s\n]*<ul>)([\s\S]*?)(</ul>[\s\n]*</div>)'

    match = re.search(related_pattern, content)

    if match:
        opening = match.group(1)
        closing = match.group(3)

        # Build new list items
        new_items = []
        for href, title in links:
            new_items.append(f'                <li><a href="{href}" class="btn-tertiary">{title}</a></li>')

        new_list_content = '\n'.join(new_items)
        new_related_section = opening + '\n' + new_list_content + '\n            ' + closing

        # Replace in content
        content = content[:match.start()] + new_related_section + content[match.end():]

        print(f"✅ {filename}")
        print(f"   - Removed top 'Back to Free Resources' link")
        print(f"   - Removed inline CSS causing underlines")
        print(f"   - Updated with {len(links)} related article links")

        # Write the updated content
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
    else:
        print(f"⚠️  {filename} - Could not find related-articles section")

print("\n✨ Comprehensive blog link fix complete!")
print("\nAll changes:")
print("  • Removed 'Back to Free Resources' from top of articles")
print("  • Removed inline CSS causing underlines on hover")
print("  • Reorganized related article links for better relevance")
print("  • Added 'Back to Free Resources' as 4th link at bottom")
print("  • All links now use consistent .btn-tertiary styling (teal, no underline, right arrow)")
