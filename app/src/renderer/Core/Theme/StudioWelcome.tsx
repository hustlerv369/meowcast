import { useEffect, useRef, useState } from "react";
import { StudioWordmark } from "../Components/StudioWordmark";
import { useSetting } from "../Hooks/useSetting";
import { StudioAppearance } from "./StudioAppearance";
import { useStudioCopy } from "./useStudioCopy";

export const StudioPrivacyIntro = () => {
    const copy = useStudioCopy();
    return (
        <dl className="studio-guide">
            <div>
                <dt>{copy.aiGuideTitle}</dt>
                <dd>{copy.aiGuide}</dd>
            </div>
            <div>
                <dt>{copy.clipboardGuideTitle}</dt>
                <dd>{copy.clipboardGuide}</dd>
            </div>
            <div>
                <dt>{copy.offlineGuideTitle}</dt>
                <dd>{copy.offlineGuide}</dd>
            </div>
        </dl>
    );
};

export const StudioWelcome = ({ onDone, firstRun }: { onDone: (openAi: boolean) => void; firstRun: boolean }) => {
    const copy = useStudioCopy();
    const { value: shortcut } = useSetting({ key: "general.hotkey", defaultValue: "Alt+Space" });
    const { value: shortcutEnabled } = useSetting({ key: "general.hotkey.enabled", defaultValue: true });
    const [step, setStep] = useState(0);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const heading = useRef<HTMLHeadingElement>(null);
    const showLook = !firstRun || step === 1;
    const finalStep = !firstRun || step === 2;
    const finish = async (openAi: boolean) => {
        setSaving(true);

        try {
            if (firstRun) {
                await window.ContextBridge.updateSettingValue("studio.onboardingComplete", true);
            }

            onDone(openAi);
        } catch {
            setError(copy.setupError);
            setSaving(false);
        }
    };
    useEffect(() => {
        heading.current?.focus();
    }, [step]);
    return (
        <main className="studio-welcome">
            <header className="studio-welcome-header draggable-area">
                <StudioWordmark />
                <span className="studio-caption">{firstRun ? copy.welcome : copy.appearance}</span>
            </header>
            {firstRun && (
                <ol className="studio-steps" aria-label={copy.setupProgress}>
                    {[copy.stepBasics, copy.stepLook, copy.stepPrivacy].map((label, index) => (
                        <li key={label} aria-current={step === index ? "step" : undefined} data-complete={step > index}>
                            <span aria-hidden="true">{index + 1}</span>
                            {label}
                        </li>
                    ))}
                </ol>
            )}
            <div className={`studio-welcome-body${firstRun && showLook ? " studio-first-look" : ""}`}>
                <div className="studio-intro">
                    <h1 ref={heading} tabIndex={-1}>
                        {showLook ? copy.chooseLook : step === 0 ? copy.welcomeTitle : copy.privacyTitle}
                    </h1>
                    <p>
                        {showLook ? copy.previewHint : step === 0 ? copy.welcomeDescription : copy.privacyDescription}
                    </p>
                </div>
                {showLook ? (
                    <StudioAppearance />
                ) : step === 0 ? (
                    <dl className="studio-guide">
                        <div>
                            <dt>{copy.appGuideTitle}</dt>
                            <dd>{copy.appGuide}</dd>
                        </div>
                        <div>
                            <dt>{copy.calcGuideTitle}</dt>
                            <dd>{copy.calcGuide}</dd>
                        </div>
                        <div>
                            <dt>{copy.keyboardGuideTitle}</dt>
                            <dd>{copy.keyboardGuide}</dd>
                        </div>
                    </dl>
                ) : (
                    <StudioPrivacyIntro />
                )}
                {(step === 0 || !firstRun) && (
                    <p className="studio-shortcut-note">
                        {shortcutEnabled ? (
                            <>
                                {copy.shortcutBefore} <kbd>{shortcut}</kbd>
                                {copy.shortcutAfter}
                            </>
                        ) : (
                            copy.shortcutDisabled
                        )}
                    </p>
                )}
                {error && <p role="alert">{error}</p>}
            </div>
            <footer className="studio-welcome-footer">
                <div>
                    {firstRun && step > 0 && (
                        <button
                            type="button"
                            className="studio-button"
                            disabled={saving}
                            onClick={() => setStep(step - 1)}
                        >
                            {copy.previous}
                        </button>
                    )}
                </div>
                <div className="studio-onboarding-actions">
                    {firstRun && finalStep && (
                        <button
                            type="button"
                            className="studio-button"
                            disabled={saving}
                            onClick={() => void finish(true)}
                        >
                            {copy.setupAi}
                        </button>
                    )}
                    <button
                        type="button"
                        className="studio-button studio-primary"
                        disabled={saving}
                        onClick={() => (finalStep ? void finish(false) : setStep(step + 1))}
                    >
                        {!finalStep ? copy.next : firstRun ? copy.finishWithoutAi : copy.back}
                    </button>
                </div>
            </footer>
        </main>
    );
};
