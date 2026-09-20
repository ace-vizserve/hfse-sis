import { RecordNotFound } from '@/components/ui/record-not-found';

// A 404 raised inside Records — a record id that resolved to nothing. Sits
// beside the module layout so the sidebar and header stay put: losing the
// chrome as well as the record makes a missing student feel like a broken app.
export default function NotFound() {
  return (
    <RecordNotFound
      scope="Records"
      homeHref="/records"
      homeLabel="Back to Records"
    />
  );
}
