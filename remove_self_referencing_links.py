#!/usr/bin/env python3
"""
Remove self-referencing links from related articles sections.
A blog post should not link to itself.
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

    original_content = content

    # Find the related-articles section
    related_pattern = r'(<div class="related-articles">.*?<ul>)(.*?)(</ul>\s*</div>)'
    related_match = re.search(related_pattern, content, re.DOTALL)

    if related_match:
        opening = related_match.group(1)
        list_content = related_match.group(2)
        closing = related_match.group(3)

        # Extract all list items
        li_pattern = r'<li>.*?</li>'
        list_items = re.findall(li_pattern, list_content, re.DOTALL)

        # Remove items that link to the current page
        filtered_items = []
        removed_count = 0

        for item in list_items:
            # Extract the href from this item
            link_match = re.search(r'href="([^"]+)"', item)
            if link_match:
                link = link_match.group(1)
                if link != filename:
                    filtered_items.append(item)
                else:
                    removed_count += 1

        if removed_count > 0:
            # Reconstruct the list without self-referencing links
            new_list_content = '\n                '.join(filtered_items)
            new_related_section = opening + '\n                ' + new_list_content + '\n            ' + closing

            # Replace in content
            content = content[:related_match.start()] + new_related_section + content[related_match.end():]

            print(f"✅ {filename} - Removed {removed_count} self-referencing link(s)")

            # Write the updated content
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
        else:
            print(f"⏭️  {filename} - No self-referencing links")
    else:
        print(f"⚠️  {filename} - Could not find related-articles section")

print("\n✨ Self-referencing link removal complete!")
