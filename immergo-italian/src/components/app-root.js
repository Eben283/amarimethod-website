/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import './view-splash.js';
import './view-missions.js';
import './view-chat.js';
import './view-summary.js';
import './text-cycler.js';

class AppRoot extends HTMLElement {
    constructor() {
        super();
        this.state = {
            view: 'splash', // splash, missions, chat, summary
            selectedMission: null,
            selectedLanguage: null,
            sessionResult: null
        };
    }

    connectedCallback() {
        // Setup static layout once
        this.innerHTML = '';

        // Theme State
        this.themes = ['dark', 'light', 'system'];
        this.currentTheme = localStorage.getItem('theme') || 'system';

        // System Theme Listener
        this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.mediaQuery.addEventListener('change', () => {
            if (this.currentTheme === 'system') {
                this.applyTheme('system');
            }
        });

        // Initial Theme Application
        this.applyTheme(this.currentTheme);

        // Persistent Header container
        const header = document.createElement('header');
        header.style.cssText = `
            display: flex;
            justify-content: flex-end;
            align-items: center;
            padding: var(--spacing-sm) var(--spacing-md);
            gap: var(--spacing-md);
            width: 100%;
            pointer-events: none; /* Let clicks pass through to underlying elements if needed, but buttons need pointer-events: auto */
        `;

        header.innerHTML = `
            <button id="theme-toggle" aria-label="Toggle Theme" style="
                pointer-events: auto;
                background: var(--color-surface);
                color: var(--color-text-main);
                border: 1px solid var(--glass-border);
                border-radius: 50%;
                width: 40px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: var(--shadow-sm);
                font-size: 1.2rem;
                transition: all 0.2s ease;
                backdrop-filter: blur(10px);
            ">
                <span class="theme-icon"></span>
            </button>
        `;

        this.appendChild(header);

        // Theme Toggle Logic
        const themeBtn = header.querySelector('#theme-toggle');
        themeBtn.onclick = () => this.cycleTheme();
        this.themeBtn = themeBtn;
        this.updateThemeBtnIcon();


        // View Container
        this.viewContainer = document.createElement('div');
        this.viewContainer.style.height = "100%";
        this.viewContainer.style.width = "100%";
        this.appendChild(this.viewContainer);

        this.render();

        this.checkConfigStatus();

        this.addEventListener('navigate', (e) => {
            this.state.view = e.detail.view;
            if (e.detail.mission) this.state.selectedMission = e.detail.mission;
            if (e.detail.language) this.state.selectedLanguage = e.detail.language;
            if (e.detail.fromLanguage) this.state.selectedFromLanguage = e.detail.fromLanguage;
            if (e.detail.mode) this.state.selectedMode = e.detail.mode;
            if (e.detail.result) this.state.sessionResult = e.detail.result;
            this.render();
        });
    }

    applyTheme(theme) {
        if (theme === 'system') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            this.setLightMode(!prefersDark);
        } else {
            this.setLightMode(theme === 'light');
        }
    }

    setLightMode(isLight) {
        if (isLight) {
            document.body.classList.add('light-mode');
        } else {
            document.body.classList.remove('light-mode');
        }
    }

    cycleTheme() {
        // Cycle: Dark -> Light -> System -> Dark
        const modes = ['dark', 'light', 'system'];
        const currentIdx = modes.indexOf(this.currentTheme);
        // Handle case where currentTheme might be invalid or old
        const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % modes.length;

        this.currentTheme = modes[nextIdx];
        localStorage.setItem('theme', this.currentTheme);
        this.applyTheme(this.currentTheme);
        this.updateThemeBtnIcon();
    }

    updateThemeBtnIcon() {
        if (!this.themeBtn) return;

        let icon = '';
        let title = '';

        switch (this.currentTheme) {
            case 'light':
                icon = '☀️'; // Sun
                title = 'Light Mode';
                break;
            case 'dark':
                icon = '🌙'; // Moon
                title = 'Dark Mode';
                break;
            case 'system':
                icon = '💻'; // Laptop/System
                title = 'System Default';
                break;
        }

        const iconSpan = this.themeBtn.querySelector('.theme-icon');
        if (iconSpan) iconSpan.textContent = icon;
        this.themeBtn.title = title;
    }

    async checkConfigStatus() {
        // Personal deploy: skip Simple Mode banner
        return;
    }

    showSimpleModeWarning(missing) {
        const warning = document.createElement('div');
        warning.style.cssText = `
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: #fff3cd;
            color: #856404;
            padding: 8px 16px;
            text-align: center;
            font-size: 0.9rem;
            z-index: 9999;
            border-top: 1px solid #ffeeba;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 8px;
            box-shadow: 0 -2px 10px rgba(0,0,0,0.05);
        `;

        const missingText = missing.join(' & ');
        warning.innerHTML = `
            <span>⚠️ <b>Simple Mode Check:</b> Production security features (${missingText}) are not configured.</span>
            <a href="https://github.com/ZackAkil/immersive-language-learning-with-live-api#advanced-configuration" target="_blank" style="color: #533f03; text-decoration: underline; font-weight: bold; margin-left: 4px;">Learn more</a>
        `;

        this.appendChild(warning);
    }

    render() {
        if (!this.viewContainer) return;

        this.viewContainer.innerHTML = '';
        let currentView;

        switch (this.state.view) {
            case 'splash':
                currentView = document.createElement('view-splash');
                break;
            case 'missions':
                currentView = document.createElement('view-missions');
                break;
            case 'chat':
                currentView = document.createElement('view-chat');
                currentView.mission = this.state.selectedMission;
                currentView.language = this.state.selectedLanguage;
                currentView.fromLanguage = this.state.selectedFromLanguage;
                currentView.mode = this.state.selectedMode;
                break;
            case 'summary':
                currentView = document.createElement('view-summary');
                currentView.result = this.state.sessionResult;
                break;
            default:
                currentView = document.createElement('view-splash');
        }

        currentView.classList.add('fade-in');
        this.viewContainer.appendChild(currentView);
    }
}

customElements.define('app-root', AppRoot);
