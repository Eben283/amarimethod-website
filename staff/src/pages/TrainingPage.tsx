import {
  BookOpenText,
  ChevronRight,
  Compass,
  FileText,
  GraduationCap,
  MessageCircle,
  Palette,
  Zap,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import SharpenDeck from '../components/SharpenDeck';
import AmariDescriptionLab from '../components/AmariDescriptionLab';
import {
  trainingPath,
  trainingPlaybookFromSearch,
  trainingSectionFromSearch,
  type TrainingPlaybook,
  type TrainingSection,
} from '../lib/training-sections';
import PlaybookPage from './PlaybookPage';
import './TrainingPage.css';

const SECTIONS: { id: TrainingSection; label: string; detail: string; Icon: typeof Zap }[] = [
  { id: 'amari', label: 'Describe Amari', detail: 'Practice, edit, and improve the words', Icon: MessageCircle },
  { id: 'sharpen', label: 'Sharpen', detail: 'Five call-craft cards', Icon: Zap },
  { id: 'playbooks', label: 'Playbooks & scripts', detail: 'Exact words with the reason behind them', Icon: BookOpenText },
  { id: 'reference', label: 'Reference', detail: 'Positioning and language standards', Icon: Compass },
];

export default function TrainingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const section = trainingSectionFromSearch(location.search);
  const playbook = trainingPlaybookFromSearch(location.search);

  function choose(next: TrainingSection) {
    navigate(trainingPath(next));
  }

  function choosePlaybook(next: TrainingPlaybook) {
    navigate(trainingPath('playbooks', next));
  }

  return (
    <main className="training-page">
      <header className="training-head">
        <div>
          <span>Staff development</span>
          <h1>Training</h1>
          <p>Practice the conversations before they matter. Keep the exact words close when they do.</p>
        </div>
        <ol aria-label="Amari training cycle">
          <li><b>Review</b><small>one useful move</small></li>
          <li><b>Rehearse</b><small>the words aloud</small></li>
          <li><b>Use</b><small>then bring back evidence</small></li>
        </ol>
      </header>

      <nav className="training-sections" aria-label="Training sections">
        {SECTIONS.map(({ id, label, detail, Icon }) => (
          <button
            key={id}
            type="button"
            className={section === id ? 'is-active' : ''}
            onClick={() => choose(id)}
            aria-current={section === id ? 'page' : undefined}
          >
            <Icon aria-hidden="true" />
            <span><strong>{label}</strong><small>{detail}</small></span>
          </button>
        ))}
      </nav>

      {section === 'sharpen' ? (
        <section className="training-panel training-panel--sharpen" aria-labelledby="training-sharpen-title">
          <header className="training-panel__intro">
            <div><span>Daily practice</span><h2 id="training-sharpen-title">One move at a time</h2></div>
            <p>Five cards rotate each day. Read one, say the move in your own voice, then use it when the next real conversation gives you the opening.</p>
          </header>
          <SharpenDeck />
        </section>
      ) : null}

      {section === 'amari' ? <AmariDescriptionLab /> : null}

      {section === 'playbooks' ? (
        <section className="training-panel training-panel--playbooks" aria-labelledby="training-playbooks-title">
          <header className="training-panel__intro">
            <div><span>Conversation guides</span><h2 id="training-playbooks-title">Learn the move. Use the words.</h2></div>
            <p>The scripts stay inside their teaching playbooks, beside the purpose, questions, and decision points they belong to. That keeps one current source instead of a second drifting script library.</p>
          </header>
          <PlaybookPage embedded activeTab={playbook} onTabChange={choosePlaybook} />
        </section>
      ) : null}

      {section === 'reference' ? (
        <section className="training-panel training-panel--reference" aria-labelledby="training-reference-title">
          <header className="training-panel__intro">
            <div><span>Use when needed</span><h2 id="training-reference-title">Reference</h2></div>
            <p>Positioning and language standards support the training. They do not replace the source-controlled playbooks above.</p>
          </header>
          <div className="training-reference-list">
            <button type="button" onClick={() => navigate('/design-system')}>
              <Palette aria-hidden="true" /><span><strong>Design and language system</strong><small>Current visual and verbal standards</small></span><ChevronRight aria-hidden="true" />
            </button>
            <button type="button" onClick={() => choosePlaybook('positioning')}>
              <GraduationCap aria-hidden="true" /><span><strong>Current Amari positioning</strong><small>Open Positioning V2 inside the teaching playbooks</small></span><ChevronRight aria-hidden="true" />
            </button>
            <a href="/staff/resources/garrett-amari-practice-sales-worksheet.pdf" target="_blank" rel="noreferrer">
              <FileText aria-hidden="true" /><span><strong>$5,400 Amari Practice sales worksheet</strong><small>50-minute Assessment conversation and decision worksheet</small></span><ChevronRight aria-hidden="true" />
            </a>
            <a href="/staff/resources/amari-sales-scripts-and-hormozi-closer-handbook-sections.pdf" target="_blank" rel="noreferrer">
              <FileText aria-hidden="true" /><span><strong>Sales scripts</strong><small>Rewritten closer scripts and reference</small></span><ChevronRight aria-hidden="true" />
            </a>
          </div>
        </section>
      ) : null}
    </main>
  );
}
