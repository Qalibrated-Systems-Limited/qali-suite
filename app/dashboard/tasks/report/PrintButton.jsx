"use client";

export default function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} style={{ fontSize: 12, padding: "5px 10px", fontWeight: 700 }}>
      Print
    </button>
  );
}
