import LiveTrackClient from "@/components/LiveTrackClient";

export default async function TrackPage({
  params,
}: {
  params: Promise<{ imei: string }>;
}) {
  const { imei } = await params;
  return <LiveTrackClient imei={imei} />;
}
