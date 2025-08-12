import createMiddleware from 'next-intl/middleware';

export default createMiddleware({
  // A list of all locales that are supported
  locales: ['en', 'es'],

  // Used when no locale matches
  defaultLocale: 'es',

  // The `localePrefix` option is used to control whether the locale should
  // be included in the URL.
  // - `as-needed`: The locale is only included in the URL if it's not the default locale.
  // - `always`: The locale is always included in the URL.
  // - `never`: The locale is never included in the URL.
  localePrefix: 'as-needed'
});

export const config = {
  // Match all pathnames except for
  // - … if they start with `/api`, `/_next` or `/_vercel`
  // - … the ones containing a dot (e.g. `favicon.ico`)
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
};
