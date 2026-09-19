import styles from "./Skeleton.module.css";

export function Bone({
  w,
  h = 10,
  className,
}: {
  w?: number | string;
  h?: number | string;
  className?: string;
}) {
  return (
    <span
      className={className ? `${styles.bone} ${className}` : styles.bone}
      style={{ width: w, height: h }}
      aria-hidden="true"
    />
  );
}
