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

class ViewSummary extends HTMLElement {
  constructor() {
    super();
    this._result = null;
  }

  set result(value) {
    this._result = value;
    this.render();
  }

  connectedCallback() {
    this.render();
  }

  render() {
    if (!this._result) return;

    if (this._result.incomplete) {
      this.innerHTML = `
          <div class="container text-center">
            <h2 style="margin-top: var(--spacing-xl); color: var(--color-text-sub);">Mission Ended</h2>
            
            <div style="margin: var(--spacing-xxl) 0; opacity: 0.7;">
                <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                <p style="margin-top: var(--spacing-md); font-size: 1.1rem;">
                    You didn't complete the mission objectives.<br>
                    No score awarded this time.
                </p>
            </div>

            <div style="flex: 1;"></div>

            <div style="
                margin-top: var(--spacing-sm);
                margin-bottom: var(--spacing-xl);
                padding: var(--spacing-xl);
                background: linear-gradient(135deg, rgba(var(--color-accent-primary-rgb), 0.1) 0%, rgba(var(--color-accent-secondary-rgb), 0.1) 100%);
                border-radius: var(--radius-lg);
                text-align: center;
                border: 1px dashed var(--color-accent-primary);
            ">
                <h3 style="margin-bottom: var(--spacing-sm); color: var(--color-accent-primary);"> Build Your Own Version </h3>
                <p style="margin-bottom: var(--spacing-lg); opacity: 0.8; line-height: 1.5;">
                    Add more missions or features <br>
                </p>
                
                <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 12px;">
                </div>
            </div>
            <button id="home-btn" class="btn-primary">Back to mission list</button>
          </div>
        `;
    } else {
      this.innerHTML = `
          <div class="container text-center">
            <h2 style="margin-top: var(--spacing-xl); color: var(--color-accent-secondary);">Mission Accomplished!</h2>
            
            <div style="margin: var(--spacing-lg) 0;">
              ${this._result.score !== "0" && this._result.score !== 0 ? this._renderScore(this._result.score) : '<p style="font-size: 1.2rem; opacity: 0.8;">Practice session complete!</p>'}
            </div>

            <div class="card" style="text-align: left;">
              <h4 style="border-bottom: 2px solid var(--color-bg); padding-bottom: var(--spacing-sm);">Feedback</h4>
              <ul style="padding-left: var(--spacing-lg); color: var(--color-text-sub);">
                ${this._result.notes.map(note => `<li>${note}</li>`).join('')}
              </ul>
            </div>

            <div style="flex: 1;"></div>

            <div style="
                margin-top: var(--spacing-sm);
                margin-bottom: var(--spacing-xl);
                padding: var(--spacing-xl);
                background: linear-gradient(135deg, rgba(var(--color-accent-primary-rgb), 0.1) 0%, rgba(var(--color-accent-secondary-rgb), 0.1) 100%);
                border-radius: var(--radius-lg);
                text-align: center;
                border: 1px dashed var(--color-accent-primary);
            ">
                <h3 style="margin-bottom: var(--spacing-sm); color: var(--color-accent-primary);"> Build Your Own Version </h3>
                <p style="margin-bottom: var(--spacing-lg); opacity: 0.8; line-height: 1.5;">
                    Add more missions or features <br>
                </p>
            </div>

            <button id="home-btn" class="btn-primary">Back to mission list</button>
          </div>
        `;
    }

    // Add common button style if not in CSS, or duplicate online styles for now to be safe as I see inline styles used before
    const btn = this.querySelector('#home-btn');
    btn.style.cssText = `
        background: var(--color-accent-primary);
        color: white;
        padding: 20px var(--spacing-xl);
        font-size: 1.25rem;
        font-weight: 800;
        border-radius: var(--radius-lg);
        width: 100%;
        margin-bottom: var(--spacing-xxl);
        box-shadow: 0 10px 20px -5px rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.1);
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.19, 1, 0.22, 1);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    `;

    btn.onmouseover = () => {
      btn.style.transform = 'translateY(-4px) scale(1.01)';
      btn.style.boxShadow = '0 15px 30px -10px rgba(163, 177, 138, 0.4)';
      btn.style.filter = 'brightness(1.1)';
    };
    btn.onmouseout = () => {
      btn.style.transform = 'translateY(0) scale(1)';
      btn.style.boxShadow = '0 10px 20px -5px rgba(0,0,0,0.3)';
      btn.style.filter = 'brightness(1)';
    };

    btn.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('navigate', {
        bubbles: true,
        detail: { view: 'missions', mission: null, result: null }
      }));
    });
  }
  _renderScore(score) {
    const levels = [
      { id: '1', title: 'Tiro', stars: 1 },
      { id: '2', title: 'Proficiens', stars: 2 },
      { id: '3', title: 'Peritus', stars: 3 }
    ];

    const currentLevel = levels.find(l => l.id === score.toString()) || levels[0];
    const descriptions = {
      '1': 'You needed a lot of help',
      '2': 'A little help',
      '3': 'No help, fluid'
    };

    const starIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;

    const scaleHtml = levels.map(level => {
      const isCurrent = level.id === score.toString();
      const opacity = isCurrent ? '1' : '0.3';
      const color = isCurrent ? 'var(--color-accent-primary)' : 'var(--color-text-main)';
      const weight = isCurrent ? 'bold' : 'normal';
      const fontSize = isCurrent ? '1.1rem' : '0.9rem';

      // Generate stars
      let starsHtml = '';
      for (let i = 0; i < level.stars; i++) starsHtml += starIcon;

      return `
        <div style="flex: 1; opacity: ${opacity}; color: ${color}; transition: all 0.3s ease; display: flex; flex-direction: column; align-items: center; gap: 4px;">
           <div style="display: flex; gap: 2px; color: ${isCurrent ? 'var(--color-accent-secondary)' : 'currentColor'}">
             ${starsHtml}
           </div>
           <span style="font-family: var(--font-heading); font-weight: ${weight}; font-size: ${fontSize};">${level.title}</span>
        </div>
      `;
    }).join('');

    return `
      <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: var(--spacing-md); height: 80px;">
        ${scaleHtml}
      </div>
      <p style="font-size: 1rem; opacity: 0.8; font-style: italic; margin-top: var(--spacing-md);">(${descriptions[score.toString()] || ''})</p>
    `;
  }
}

customElements.define('view-summary', ViewSummary);
