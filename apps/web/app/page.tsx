import { IncidentView } from "./incident-view";

export default function Home() {
  const storageEnabled = Boolean(process.env.BLOB_READ_WRITE_TOKEN && process.env.DATABASE_URL);
  return <IncidentView storageEnabled={storageEnabled} />;
}
