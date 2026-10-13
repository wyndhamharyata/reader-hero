interface Props {
  show: boolean;
}

export function InstallHint({ show }: Props) {
  if (!show) return null;
  return (
    <div className="alert py-2 text-xs alert-info" data-tour="install">
      <span>Add Reader Hero to your Home Screen so iOS keeps your library offline.</span>
    </div>
  );
}
