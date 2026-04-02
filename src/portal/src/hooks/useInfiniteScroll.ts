import { useCallback, useRef } from 'react';

type UseInfiniteScrollProps = {
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
};

export const useInfiniteScroll = ({
  isLoading,
  hasMore,
  onLoadMore,
  rootMargin = '400px',
}: UseInfiniteScrollProps) => {
  const observerRef = useRef<IntersectionObserver | null>(null);

  const lastElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isLoading || !hasMore) return;

      if (observerRef.current) {
        observerRef.current.disconnect();
      }

      if (node) {
        observerRef.current = new IntersectionObserver(
          (entries) => {
            if (entries[0]?.isIntersecting) {
              onLoadMore();
            }
          },
          { rootMargin }
        );
        observerRef.current.observe(node);
      }
    },
    [isLoading, hasMore, onLoadMore, rootMargin]
  );

  return { lastElementRef };
};
