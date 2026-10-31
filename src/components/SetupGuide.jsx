import { ChevronDown, ExternalLink } from 'lucide-react';

// 準備の手順（data/setupGuide.js の形）を、開くと番号付きで見られる形で出す
export function SetupGuide({ guide, label = 'やり方を見る' }) {
  return (
    <details className="guide">
      <summary>
        {label} <ChevronDown size={16} />
      </summary>
      {guide.sections.map((section, i) => (
        <div key={i} className="guide-section">
          {section.title && <p className="guide-section-title">{section.title}</p>}
          <ol className="guide-steps">
            {section.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {section.note && <p className="guide-note">{section.note}</p>}
        </div>
      ))}
      {guide.links?.length > 0 && (
        <div className="guide-links">
          {guide.links.map((l) => (
            <a key={l.href} className="onboarding-link small" href={l.href} target="_blank" rel="noopener noreferrer">
              {l.label} <ExternalLink size={13} />
            </a>
          ))}
        </div>
      )}
    </details>
  );
}
