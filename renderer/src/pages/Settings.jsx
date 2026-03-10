import { useState } from "react";

export default function Settings() {
  const [aiEnabled, setAiEnabled] = useState(true);
  const [theme, setTheme] = useState("dark");
  const [indexDocuments, setIndexDocuments] = useState(true);
  const [indexDownloads, setIndexDownloads] = useState(false);

  return (
    <div>
      <h1>Settings</h1>
      <p style={{ opacity: 0.7 }}>
        Customize how IntelliFile works for you
      </p>

      <Section title="Appearance">
        <Toggle
          label="Dark Mode"
          checked={theme === "dark"}
          onChange={() =>
            setTheme(theme === "dark" ? "light" : "dark")
          }
        />
      </Section>

      <Section title="AI Features">
        <Toggle
          label="Enable AI features"
          checked={aiEnabled}
          onChange={() => setAiEnabled(!aiEnabled)}
        />
        <small style={{ opacity: 0.6 }}>
          Turn off AI to use IntelliFile in manual mode
        </small>
      </Section>

      <Section title="Indexing Scope">
        <Toggle
          label="Index Documents folder"
          checked={indexDocuments}
          onChange={() => setIndexDocuments(!indexDocuments)}
        />
        <Toggle
          label="Index Downloads folder"
          checked={indexDownloads}
          onChange={() => setIndexDownloads(!indexDownloads)}
        />
      </Section>

      <Section title="Privacy">
        <p style={{ opacity: 0.7 }}>
          Your files stay on your device. AI analysis will only run
          locally unless you explicitly enable cloud features.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={sectionStyle}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <div style={toggleStyle}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={onChange} />
    </div>
  );
}

const sectionStyle = {
  background: "#0f172a",
  padding: 20,
  borderRadius: 14,
  marginBottom: 20,
};

const toggleStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 10,
};
