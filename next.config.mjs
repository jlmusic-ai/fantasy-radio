/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "wruzihyziemagrrtkfgy.supabase.co",
        pathname: "/storage/v1/object/sign/avatars/**",
      },
    ],
  },
};

export default nextConfig;
