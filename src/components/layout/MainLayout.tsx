import type { ReactNode } from "react";

interface MainLayoutProps {
  toolbar: ReactNode;
  sidebar: ReactNode;
  content: ReactNode;
  statusBar: ReactNode;
}

/**
 * MainLayout — Four-region grid layout.
 *
 * Regions:
 *  - Top: toolbar
 *  - Left: sidebar (workspace index)
 *  - Center: content (editor / preview)
 *  - Bottom: status bar
 */
function MainLayout({ toolbar, sidebar, content, statusBar }: MainLayoutProps) {
  return (
    <div className="app-shell">
      <header className="app-toolbar">{toolbar}</header>
      <aside className="app-sidebar">{sidebar}</aside>
      <main className="app-content">{content}</main>
      <footer className="app-statusbar">{statusBar}</footer>
    </div>
  );
}

export default MainLayout;