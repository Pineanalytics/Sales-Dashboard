import { ImageResponse } from "next/og";

export const size = { width: 256, height: 256 };
export const contentType = "image/png";

/** Pinefrost Distribution network mark for browser and bookmark surfaces. */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#0B3D35",
          borderRadius: "48px",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
          width: "100%",
        }}
      >
        <div style={{ border: "20px solid #71B741", borderRadius: "999px", height: "112px", width: "112px" }} />
        <div style={{ background: "#71B741", borderRadius: "999px", height: "22px", left: "56px", position: "absolute", top: "57px", transform: "rotate(-28deg)", transformOrigin: "right center", width: "76px" }} />
        <div style={{ background: "#71B741", borderRadius: "999px", height: "42px", left: "48px", position: "absolute", top: "37px", width: "42px" }} />
        <div style={{ background: "#0B3D35", borderRadius: "999px", height: "18px", left: "60px", position: "absolute", top: "49px", width: "18px" }} />
        <div style={{ background: "#71B741", borderRadius: "999px", bottom: "44px", height: "38px", position: "absolute", right: "34px", width: "38px" }} />
        <div style={{ background: "#0B3D35", borderRadius: "999px", bottom: "54px", height: "18px", position: "absolute", right: "44px", width: "18px" }} />
      </div>
    ),
    size
  );
}
