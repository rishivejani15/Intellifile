import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './OnboardingTour.css';

const TOUR_STEPS = [
  {
    target: '[data-tour="app-navigation"]',
    title: 'Everything in one place',
    description: 'Use these sections to switch between your files, sync tools, secure vault, activity logs, and settings.'
  },
  {
    target: '[data-tour="quick-access"]',
    title: 'Quick Access',
    description: 'Jump straight to Desktop, Downloads, OneDrive, or any connected drive. Your recent locations remain easy to reach.'
  },
  {
    target: '[data-tour="folder-tabs"]',
    title: 'Work with multiple folders',
    description: 'Open a new tab for another folder and switch freely. Each tab keeps its own folder and navigation history.'
  },
  {
    target: '[data-tour="smart-search"]',
    title: 'Search smarter',
    description: 'Write a full sentence or search with context, such as “presentation about quarterly sales” or “files from July 26”. Press Enter and IntelliFile’s local AI will find and highlight the best matching files.',
    section: 'explorer'
  },
  {
    target: '[data-tour="file-browser"]',
    title: 'Manage your files',
    description: 'Open folders, select files, right-click for actions, and use the toolbar to change views, sort, or create folders.',
    section: 'explorer'
  },
  {
    target: '[data-tour="sync-overview"]',
    title: 'Sync across devices with QR pairing',
    description: 'Add files for secure transfer, then use the QR code to pair a mobile device on the same network. Scan it from IntelliFile Sync on your phone for the fastest secure connection, and review activity here afterwards.',
    section: 'sync',
    action: 'open-sync-pairing',
    cardPlacement: 'sync-pairing-left'
  },
  {
    target: '[data-tour="vault-tools"]',
    title: 'Keep sensitive files in the Vault',
    description: 'The Vault protects files with encryption. Choose Lock New File to secure a file, then use the Locked Files and History tabs to manage access.',
    section: 'vault'
  },
  {
    target: '[data-tour="version-timeline"]',
    fallbackTarget: '[data-tour="file-browser"]',
    title: 'Restore earlier versions',
    description: 'We selected an available file and opened its real Version History timeline for you. In normal use, select a supported file, right-click it, and choose Version History. Inspect, compare, and safely restore earlier versions here.',
    section: 'explorer',
    action: 'open-version-history',
    cardPlacement: 'left'
  },
  {
    target: '[data-tour="auto-sort-settings"]',
    title: 'Keep new files organized automatically',
    description: 'Enable Auto-Sort, choose the folders IntelliFile watches, and set the destination where organized files are placed.',
    section: 'settings',
    settingsTab: 'file-management'
  },
  {
    target: '[data-tour="storage-settings"]',
    title: 'Understand and manage storage',
    description: 'Review disk capacity, see which files use the most space, and keep IntelliFile storage under control.',
    section: 'settings',
    settingsTab: 'storage',
    cardPlacement: 'storage-bottom-right'
  }
];

export default function OnboardingTour({ open, onStart, onNavigate, onClose }) {
  const [mode, setMode] = useState('welcome');
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const primaryButtonRef = useRef(null);
  const step = TOUR_STEPS[stepIndex];

  useEffect(() => {
    if (!open) return;
    setMode('welcome');
    setStepIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
      if (mode === 'tour' && event.key === 'ArrowRight') setStepIndex((index) => Math.min(index + 1, TOUR_STEPS.length - 1));
      if (mode === 'tour' && event.key === 'ArrowLeft') setStepIndex((index) => Math.max(index - 1, 0));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, onClose, open]);

  useEffect(() => {
    if (open) primaryButtonRef.current?.focus();
  }, [mode, open, stepIndex]);

  useEffect(() => {
    if (open && mode === 'tour') onNavigate?.(step.section || 'explorer', step.settingsTab);
  }, [mode, onNavigate, open, step.section, step.settingsTab]);

  useEffect(() => {
    if (!open || mode !== 'tour' || !step.action) return undefined;
    const timer = window.setTimeout(() => {
      if (step.action === 'open-version-history') {
        window.dispatchEvent(new CustomEvent('intellifile-tour-open-version-history'));
      } else if (step.action === 'open-sync-pairing') {
        window.dispatchEvent(new CustomEvent('intellifile-tour-open-sync-pairing'));
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [mode, open, step.action]);

  // The caption controls are rendered by Electron outside the web page. Match
  // their native title bar to the tour scrim so they do not appear highlighted.
  useEffect(() => {
    if (!open) return undefined;

    window.intellifile?.setTitleBarOverlay?.({
      // This matches the page after the tour scrim is applied, so the native
      // caption controls do not look like a separate highlighted strip.
      color: '#58635d',
      symbolColor: '#d4ddd7',
      height: 44,
    });

    return () => {
      const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark';
      window.intellifile?.setTitleBarOverlay?.(
        isDarkTheme
          ? { color: '#09090b', symbolColor: '#e8ece9', height: 44 }
          : { color: '#ffffff', symbolColor: '#1f2937', height: 44 }
      );
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || mode !== 'tour') return undefined;
    const updateRect = () => {
      const target = document.querySelector(step.target) || (step.fallbackTarget && document.querySelector(step.fallbackTarget));
      if (!target) return setTargetRect(null);
      const rect = target.getBoundingClientRect();
      const nextRect = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
      setTargetRect((previousRect) => (
        previousRect && previousRect.top === nextRect.top && previousRect.left === nextRect.left &&
        previousRect.width === nextRect.width && previousRect.height === nextRect.height
          ? previousRect
          : nextRect
      ));
    };
    updateRect();
    const delayedUpdate = window.setTimeout(updateRect, 50);
    const observer = new MutationObserver(updateRect);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.clearTimeout(delayedUpdate);
      observer.disconnect();
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [mode, open, step]);

  if (!open) return null;

  const beginTour = () => {
    onStart?.();
    setMode('tour');
    window.dispatchEvent(new CustomEvent('intellifile-tour-start'));
  };
  const finishTour = () => onClose();
  const nextStep = () => {
    if (stepIndex === TOUR_STEPS.length - 1) finishTour();
    else setStepIndex((index) => index + 1);
  };

  const cardStyle = targetRect ? (() => {
    if (step.cardPlacement === 'sync-pairing-left') {
      // The pairing view occupies the centre of the page and its QR code is
      // the key action. Keep this explanation in the unused space to the
      // left, rather than placing it on top of the code people need to scan.
      const leftGutter = Math.max(230, Math.min(280, targetRect.left - 30));
      if (targetRect.left >= 250) {
        return {
          left: Math.max(12, targetRect.left - leftGutter - 14),
          top: Math.max(20, Math.min(targetRect.top + 24, window.innerHeight - 380)),
          width: leftGutter,
        };
      }
      return {
        left: Math.max(20, Math.min(targetRect.left + 20, window.innerWidth - 390)),
        top: Math.max(20, Math.min(targetRect.top + targetRect.height + 18, window.innerHeight - 380)),
      };
    }
    if (step.cardPlacement === 'storage-bottom-right') {
      return {
        left: Math.max(20, Math.min(targetRect.left + targetRect.width - 390, window.innerWidth - 390)),
        top: Math.max(20, window.innerHeight - 265),
      };
    }
    if (step.cardPlacement === 'left') {
      return {
        left: Math.max(20, targetRect.left - 388),
        top: Math.max(20, Math.min(targetRect.top + 20, window.innerHeight - 245))
      };
    }
    const isTallTarget = targetRect.height > 220;
    const canFitToRight = targetRect.left + targetRect.width + 390 < window.innerWidth;
    if (isTallTarget && canFitToRight) {
      return {
        left: targetRect.left + targetRect.width + 18,
        top: Math.max(20, Math.min(targetRect.top + 24, window.innerHeight - 245))
      };
    }
    return {
      left: Math.max(20, Math.min(targetRect.left, window.innerWidth - 390)),
      top: targetRect.top + targetRect.height + 18 < window.innerHeight - 245
        ? targetRect.top + targetRect.height + 18
        : Math.max(20, targetRect.top - 245)
    };
  })() : undefined;

  const spotlightStyle = targetRect ? (() => {
    const padding = 6;
    const topOverflow = Math.max(0, padding - targetRect.top);
    const leftOverflow = Math.max(0, padding - targetRect.left);
    return {
      // Preserve the target's true size. At a window edge, only the outside
      // padding is removed instead of moving the outline inward.
      top: Math.max(0, targetRect.top - padding),
      left: Math.max(0, targetRect.left - padding),
      width: targetRect.width + (padding * 2) - leftOverflow,
      height: targetRect.height + (padding * 2) - topOverflow,
    };
  })() : undefined;

  return (
    <div className="onboarding-tour" role="presentation">
      {mode === 'welcome' && <div className="onboarding-backdrop" />}
      {mode === 'tour' && targetRect && (
        <div
          className="onboarding-spotlight"
          style={spotlightStyle}
        />
      )}

      {mode === 'welcome' ? (
        <section className="onboarding-welcome" role="dialog" aria-modal="true" aria-labelledby="onboarding-welcome-title">
          <div className="onboarding-badge">WELCOME TO INTELLIFILE</div>
          <h2 id="onboarding-welcome-title">Your files, easier to find and manage.</h2>
          <p>Take a short tour to see how to navigate folders, work in tabs, search with AI, and manage files securely on your device.</p>
          <div className="onboarding-actions">
            <button type="button" className="onboarding-button ghost" onClick={onClose}>Skip for now</button>
            <button ref={primaryButtonRef} type="button" className="onboarding-button primary" onClick={beginTour}>Take the tour</button>
          </div>
        </section>
      ) : (
        <section className="onboarding-card" style={cardStyle} role="dialog" aria-modal="true" aria-labelledby="onboarding-step-title">
          <div className="onboarding-step-count">{stepIndex + 1} of {TOUR_STEPS.length}</div>
          <h2 id="onboarding-step-title">{step.title}</h2>
          <p>{step.description}</p>
          <div className="onboarding-progress" aria-hidden="true">
            {TOUR_STEPS.map((_, index) => <span key={index} className={index <= stepIndex ? 'complete' : ''} />)}
          </div>
          <div className="onboarding-actions">
            <button type="button" className="onboarding-button ghost" onClick={onClose}>End tour</button>
            <div className="onboarding-next-actions">
              {stepIndex > 0 && <button type="button" className="onboarding-button ghost" onClick={() => setStepIndex((index) => index - 1)}>Back</button>}
              <button ref={primaryButtonRef} type="button" className="onboarding-button primary" onClick={nextStep}>{stepIndex === TOUR_STEPS.length - 1 ? 'Finish' : 'Next'}</button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
