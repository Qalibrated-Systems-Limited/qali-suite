"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  SHEET_BY_CODE,
  sheetName,
  displaySerial,
  STATUS_CONFIG,
  FOLDERS,
  FOLDER_ICON_PATHS,
  statusesForFolder,
  timeAgo,
} from "../lib/meta";

/**
 * The QSL Report Registry, in React. Reports come from the server; the folder
 * browse, the search and the status cards are all client-side, ported from the
 * standalone app's registry so it reads and behaves the same inside the ERP.
 */
export default function RegistryBrowser({ reports = [], projectId }) {
  const router = useRouter();
  const [folder, setFolder] = useState("folders"); // "folders" | folder key
  const [query, setQuery] = useState("");

  const countFor = useMemo(() => {
    const c = {};
    for (const f of FOLDERS) {
      const set = new Set(statusesForFolder(f.key));
      c[f.key] = reports.filter((r) => set.has(r.status)).length;
    }
    return c;
  }, [reports]);

  const matches = (r, q) => {
    q = q.toLowerCase();
    return (
      String(r.reportNumber || "").toLowerCase().includes(q) ||
      String(r.title || "").toLowerCase().includes(q) ||
      String(r.createdByName || "").toLowerCase().includes(q) ||
      sheetName(r.type).toLowerCase().includes(q)
    );
  };

  const searching = query.trim().length > 0;
  const showFolders = folder === "folders" && !searching;

  const list = useMemo(() => {
    let l = reports;
    if (searching) {
      l = l.filter((r) => matches(r, query.trim()));
    } else if (folder !== "folders") {
      const set = new Set(statusesForFolder(folder));
      l = l.filter((r) => set.has(r.status));
    }
    return [...l].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [reports, folder, query, searching]);

  const open = (r) => router.push(`/dashboard/technical/${r.id}`);

  return (
    <>
      <div className="tech-tool">
        <div className="tech-search-row">
          <div className="tech-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search serial, title, sheet or author…"
            />
          </div>
        </div>
      </div>

      {showFolders ? (
        <>
          <p className="tech-section-label">Browse by status</p>
          <div className="tech-folders">
            {FOLDERS.map((f) => (
              <div
                key={f.key}
                className="tech-folder"
                onClick={() => setFolder(f.key)}
                style={{ background: `linear-gradient(135deg, ${f.g1}, ${f.g2})` }}
              >
                <span
                  className="ficon"
                  dangerouslySetInnerHTML={{
                    __html: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#241F1B" stroke-width="2.2">${FOLDER_ICON_PATHS[f.icon]}</svg>`,
                  }}
                />
                <div className="fcount">{countFor[f.key] ?? 0}</div>
                <div className="flabel">{f.label}</div>
                <div className="fcap">{f.caption}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="tech-list-head">
            <h2>
              {searching
                ? `Search results for “${query.trim()}”`
                : FOLDERS.find((f) => f.key === folder)?.label}
            </h2>
            <span className="n">
              {!searching && (
                <button
                  className="tech-btn-ghost"
                  style={{ marginRight: 10 }}
                  onClick={() => setFolder("folders")}
                >
                  ‹ All folders
                </button>
              )}
              {list.length} report{list.length === 1 ? "" : "s"}
            </span>
          </div>

          {list.length === 0 ? (
            <div className="tech-empty">No reports match.</div>
          ) : (
            <div className="tech-grid">
              {list.map((r) => {
                const st = STATUS_CONFIG[r.status] || STATUS_CONFIG.draft;
                const sheet = SHEET_BY_CODE[r.type];
                return (
                  <a
                    key={r.id}
                    className="tech-card"
                    onClick={(e) => {
                      e.preventDefault();
                      open(r);
                    }}
                    href={`/dashboard/technical/${r.id}`}
                  >
                    <span
                      className="tech-card-fold"
                      style={{ borderColor: `transparent ${st.color} transparent transparent` }}
                    />
                    <div className="tech-card-body">
                      <span className="tech-serial">{displaySerial(r.reportNumber)}</span>
                      <p className="tech-card-title">{r.title}</p>
                      <p className="tech-card-sub">
                        {sheet ? sheet.name : sheetName(r.type)}
                      </p>
                      <span className="tech-byline">
                        by {r.createdByName} · {timeAgo(r.createdAt)}
                      </span>
                    </div>
                    <div className="tech-card-band" style={{ background: st.color }}>
                      <span>{st.label}</span>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
