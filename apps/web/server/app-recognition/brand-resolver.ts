/**
 * Server re-export of the brand resolver. The canonical implementation is
 * the client-safe `features/app-recognition/brand-aliases.ts` (task 024:
 * the offline JSON import resolves brand icons locally); this module keeps
 * the historical server import path stable.
 */

export {
  resolveBrandFromHostname,
  brandAliasHostnames,
  brandAliasIconKeys,
} from "../../features/app-recognition/brand-aliases";
export type { BrandMatch } from "../../features/app-recognition/brand-aliases";
