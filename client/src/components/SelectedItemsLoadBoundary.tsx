import { useRef, useEffect } from "react";
import type { RefObject } from "react";
import { Box } from "@mui/material";

import type { SelectedItemsPageRequest } from "@inventory/shared";

type BoundaryProps = {
  rootRef: RefObject<HTMLDivElement | null>;
  before: string | null;
  after: string | null;
  disabled: boolean;
  search: string;
  onLoad: (request: SelectedItemsPageRequest) => void;
};

export function SelectedItemsLoadBoundary({
  rootRef,
  before,
  after,
  disabled,
  search,
  onLoad,
}: BoundaryProps) {
  const markerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const marker = markerRef.current;

    if (
      disabled ||
      root === null ||
      marker === null ||
      (before === null && after === null)
    ) {
      return;
    }

    let active = true;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.find((item) => item.isIntersecting);

        if (!active || entry === undefined) {
          return;
        }

        const midpoint =
          root.getBoundingClientRect().top + root.clientHeight / 2;

        const loadBefore =
          before !== null &&
          (after === null || entry.boundingClientRect.top < midpoint);

        if (loadBefore && before !== null) {
          onLoad({ search, before });
        } else if (after !== null) {
          onLoad({ search, after });
        }
      },
      {
        root,
        rootMargin: "160px 0px",
        threshold: 0,
      },
    );

    observer.observe(marker);

    return () => {
      active = false;
      observer.disconnect();
    };
  }, [rootRef, before, after, disabled, search, onLoad]);

  return <Box ref={markerRef} aria-hidden="true" sx={{ height: 48 }} />;
}
