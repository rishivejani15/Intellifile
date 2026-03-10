import Sidebar from "../components/Sidebar";

export default function AppLayout({ children, page, setPage }) {
  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <Sidebar active={page} setActive={setPage} />
      <main style={{ flex: 1, padding: "24px" }}>{children}</main>
    </div>
  );
}
