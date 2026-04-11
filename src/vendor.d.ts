declare module 'react-anchor-link-smooth-scroll' {
  import type { AnchorHTMLAttributes, FC } from 'react';
  interface AnchorLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
    href: string;
    offset?: string | number | (() => number);
  }
  const AnchorLink: FC<AnchorLinkProps>;
  export default AnchorLink;
}
