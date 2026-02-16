#!/usr/bin/env python3
"""
Fix broken blog post links in related articles sections.
Replace non-existent blog posts with existing ones that are topically similar.
"""

import re
import os

# Mapping of broken links to valid replacements
link_replacements = {
    'blog-how-to-fix-back-pain.html': 'blog-passive-bridge-mobility.html',  # Back pain -> passive bridge
    'blog-how-to-treat-lower-back-pain.html': 'blog-spinal-wave-gentle-decompression.html',  # Lower back -> spinal wave
    'blog-how-to-relieve-shoulder-pain.html': 'blog-power-posture-shoulder-blades.html',  # Shoulder -> power posture (already exists)
    'blog-how-to-fix-tech-neck-pain.html': 'blog-power-posture-shoulder-blades.html',  # Tech neck -> power posture
    'blog-carpal-tunnel-relief.html': 'blog-hand-balancer-carpal-tunnel.html',  # Carpal tunnel (already exists)
    'blog-tmj-pain-relief.html': 'blog-jaw-align-tmj-relief.html',  # TMJ (already exists)
    'blog-plantar-fasciitis-heel-pain.html': 'blog-spring-step-calf-ankle.html',  # Plantar fasciitis -> spring step (already exists)
}

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

    original_content = content
    changes_made = []

    # Replace each broken link
    for old_link, new_link in link_replacements.items():
        if old_link in content:
            content = content.replace(f'href="{old_link}"', f'href="{new_link}"')
            changes_made.append(f"{old_link} -> {new_link}")

    # Also remove any duplicate links that might result from replacements
    # Find the related-articles section and check for duplicates
    related_articles_match = re.search(r'<div class="related-articles">.*?</div>', content, re.DOTALL)

    if related_articles_match and changes_made:
        related_section = related_articles_match.group(0)

        # Extract all links in this section
        links = re.findall(r'href="(blog-[^"]+\.html)"', related_section)

        # Check for duplicates
        seen_links = set()
        duplicates_found = []
        for link in links:
            if link in seen_links:
                duplicates_found.append(link)
            seen_links.add(link)

        if duplicates_found:
            changes_made.append(f"⚠️  Duplicate links found: {', '.join(duplicates_found)}")

    if content != original_content:
        # Write the updated content
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)

        print(f"✅ {filename}")
        for change in changes_made:
            print(f"   - {change}")
    else:
        print(f"⏭️  {filename} - No broken links found")

print("\n✨ Blog link fixes complete!")
print("\nNote: Some pages may now have duplicate links. These should be manually reviewed.")
