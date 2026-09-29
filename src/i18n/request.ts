import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  // Read the locale from the environment, defaulting to 'pt'
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'pt';

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    // Fallback to Portuguese if the dictionary for the requested locale doesn't exist
    messages = (await import(`../../messages/pt.json`)).default;
  }

  return {
    locale,
    messages
  };
});
