interface Props {
  show: boolean;
}

export function InstallHint({ show }: Props) {
  if (!show) return null;
  return (
    <div className="alert alert-info py-2 text-xs">
      <span>Add Reader Hero to your Home Screen so iOS keeps your library offline.</span>
    </div>
  );
}
