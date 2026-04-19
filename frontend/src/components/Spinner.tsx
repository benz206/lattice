interface SpinnerProps {
  size?: number;
  className?: string;
}

export function Spinner({ size = 16, className }: SpinnerProps): React.JSX.Element {
  return (
    <span
      className={`lattice-spinner inline-block rounded-full border-2 border-current border-t-transparent ${
        className ?? ""
      }`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
