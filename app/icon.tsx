import { ImageResponse } from "next/og";

export const size = {
  width: 256,
  height: 256,
};

export const contentType = "image/png";

/** Branded browser and bookmark icon generated through Next.js metadata. */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#0A1F52",
          borderRadius: "48px",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            background: "#00D4FF",
            height: "18px",
            left: "24px",
            position: "absolute",
            top: "26px",
            width: "208px",
          }}
        />
        <div
          style={{
            color: "#FFFFFF",
            display: "flex",
            fontFamily: "Arial, sans-serif",
            fontSize: "172px",
            fontWeight: 800,
            height: "188px",
            lineHeight: 1,
            marginTop: "22px",
          }}
        >
          P
        </div>
        <div
          style={{
            background: "#FFB000",
            bottom: "26px",
            height: "14px",
            position: "absolute",
            width: "126px",
          }}
        />
      </div>
    ),
    size
  );
}
