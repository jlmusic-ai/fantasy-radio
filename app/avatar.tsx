import Image from "next/image";

export default function Avatar({
  name,
  url,
  size = 40,
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
  if (url) {
    return (
      <Image
        className="avatar"
        src={url}
        alt={`${name}'s profile photo`}
        width={size}
        height={size}
        unoptimized
      />
    );
  }

  return (
    <span
      className="avatar avatar-fallback"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
