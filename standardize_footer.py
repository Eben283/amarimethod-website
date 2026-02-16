#!/usr/bin/env python3
"""
Standardize footer across all HTML pages using the index.html footer as the template.
"""

import re
import os

# The standard footer HTML from index.html
standard_footer = '''    <footer>
        <div class="footer-content">
            <div class="footer-section">
                <img src="images/AmariLogo.avif" alt="Amari Method Logo" style="height: 40px; width: auto; margin-bottom: 1rem;" loading="lazy">
                <p>Freedom From Pain. Results For Life.</p>
                <p style="margin-top: 1rem; font-size: 0.9rem;">
                    hello@amarihealth.com<br>
                    San Francisco, CA
                </p>
            </div>
            <div class="footer-section">
                <h3>Services</h3>
                <ul>
                    <li><a href="in-person-sessions">In-Person Sessions</a></li>
                    <li><a href="virtual-sessions">Virtual Sessions</a></li>
                    <li><a href="booking">Online Program</a></li>
                    <li><a href="ongoing-care">Ongoing Care</a></li>
                </ul>
            </div>
            <div class="footer-section">
                <h3>About</h3>
                <ul>
                    <li><a href="#why">Why Amari Method</a></li>
                    <li><a href="#about">About Dr. Garrett</a></li>
                    <li><a href="#how">How It Works</a></li>
                    <li><a href="#results">Results & Reviews</a></li>
                </ul>
            </div>
            <div class="footer-section">
                <h3>Get Started</h3>
                <ul>
                    <li><a href="https://discoverycall.amarimethod.com/discovery-call-booking">Free Discovery Call</a></li>
                    <li><a href="client-info.html">Client Information</a></li>
                    <li><a href="booking">View Pricing & Packages</a></li>
                    <li><a href="#services">Book Your Session</a></li>
                    <li><a href="#faq">FAQ</a></li>
                </ul>
            </div>
        </div>
        <div class="footer-bottom">
            <p>Made by Forrest Designs | <a href="https://partners.amarimethod.com/partnerprogram" target="_blank" rel="noopener noreferrer">Partnership Program</a> | <a href="privacy-policy.html">Privacy Policy</a> | <a href="terms-of-use.html">Terms of Use</a> | © 2025 Amari Method</p>
        </div>
    </footer>'''

# List of all HTML files (excluding index.html since it's the source)
html_files = [
    'about.html',
    'booking.html',
    'contact.html',
    'how-it-works.html',
    'in-person-sessions.html',
    'ongoing-care.html',
    'virtual-sessions.html',
    'client-info.html',
    'tools.html',
    'blog.html',
    'privacy-policy.html',
    'terms-of-use.html',
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

# Process each HTML file
for filename in html_files:
    filepath = f'/Users/Eben/Desktop/my-new-website/{filename}'

    if not os.path.exists(filepath):
        print(f"⚠️  File not found: {filename}")
        continue

    # Read the file
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Pattern to find the footer (from <footer> to </footer>)
    pattern = r'<footer>.*?</footer>'

    match = re.search(pattern, content, re.DOTALL)

    if match:
        # Replace the old footer with the standard footer
        new_content = content[:match.start()] + standard_footer + content[match.end():]

        # Write the updated content
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)

        print(f"✅ {filename} - Footer standardized")
    else:
        print(f"⚠️  {filename} - Could not find footer tag")

print("\n✨ Footer standardization complete!")
