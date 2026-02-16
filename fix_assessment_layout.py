#!/usr/bin/env python3
"""
Add CSS to keep assessment banner as two columns on tablet/desktop screens.
"""

import re
import os

# The CSS to add (to be inserted before </head>)
assessment_css = '''
    <style>
        /* Keep assessment banner side-by-side on tablet and larger screens */
        @media (min-width: 769px) {
            .assessment-content {
                display: grid;
                grid-template-columns: auto 1fr;
                gap: 2.5rem;
                align-items: center;
            }

            .assessment-text {
                text-align: left;
            }

            .assessment-features {
                align-items: flex-start;
            }

            .assessment-image-wrapper {
                margin: 0;
            }
        }

        /* Stack on mobile */
        @media (max-width: 768px) {
            .assessment-content {
                display: flex;
                flex-direction: column;
                gap: 1.5rem;
                text-align: center;
            }

            .assessment-text {
                text-align: center;
            }

            .assessment-features {
                display: flex;
                flex-direction: column;
                align-items: center;
            }

            .assessment-image-wrapper {
                margin: 0 auto;
            }
        }
    </style>
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

    # Check if assessment layout CSS already exists
    if 'Keep assessment banner side-by-side' in content:
        print(f"⏭️  {filename} - Assessment layout CSS already exists, skipping")
        continue

    # Find </head> and insert the CSS before it
    pattern = r'(</head>)'

    match = re.search(pattern, content)

    if match:
        # Insert the CSS before </head>
        new_content = content[:match.start()] + assessment_css + '\n' + content[match.start():]

        # Write the updated content
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)

        print(f"✅ {filename} - Assessment layout CSS added")
    else:
        print(f"⚠️  {filename} - Could not find </head> tag")

print("\n✨ Assessment layout CSS update complete!")
