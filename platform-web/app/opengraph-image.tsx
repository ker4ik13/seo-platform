import { ImageResponse } from "next/og";

export const alt = "SEOньорита — единая платформа для системного SEO";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "stretch",
          background: "#f5f1e8",
          color: "#171713",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "space-between",
          padding: "64px 70px",
          position: "relative",
          width: "100%"
        }}
      >
        <div
          style={{
            background: "#f0523d",
            borderRadius: "50%",
            height: 360,
            opacity: .12,
            position: "absolute",
            right: -80,
            top: -140,
            width: 360
          }}
        />
        <div style={{ alignItems: "center", display: "flex", gap: 18 }}>
          <div
            style={{
              alignItems: "center",
              background: "#f0523d",
              borderRadius: "50%",
              color: "white",
              display: "flex",
              fontSize: 30,
              height: 58,
              justifyContent: "center",
              width: 58
            }}
          >
            S
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <strong style={{ fontSize: 32, letterSpacing: "-1.5px" }}>SEOньорита</strong>
            <span style={{ color: "#69675f", fontSize: 14, letterSpacing: "2px" }}>SEONORITA</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 900 }}>
          <span style={{ color: "#f0523d", fontSize: 18, fontWeight: 700, letterSpacing: "2px" }}>
            ПЛАТФОРМА В РАЗРАБОТКЕ
          </span>
          <div style={{ fontSize: 78, fontWeight: 650, letterSpacing: "-5px", lineHeight: .96, marginTop: 24 }}>
            SEO без хаоса. Одна система для всей работы.
          </div>
        </div>
        <div style={{ alignItems: "center", borderTop: "1px solid rgba(23,23,19,.18)", display: "flex", justifyContent: "space-between", paddingTop: 24 }}>
          <span style={{ color: "#69675f", fontSize: 18 }}>Семантика · Позиции · SERP · Контент · Команда</span>
          <span style={{ color: "#f0523d", fontSize: 18, fontWeight: 700 }}>Ждите запуск →</span>
        </div>
      </div>
    ),
    size
  );
}
