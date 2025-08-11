async function checkR2Config() {
  try {
    const endpoint = process.env.R2_ENDPOINT;
    const accessKeyPresent = !!(process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY);
    const secretKeyPresent = !!(process.env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY);

    if (!endpoint || !accessKeyPresent || !secretKeyPresent) {
      throw new Error('Missing R2 configuration');
    }

    await r2Client.send(new ListBucketsCommand({}));
    return true;
  } catch (error) {
    logger.error('R2 configuration check failed', {
      error: error.message,
      config: {
        endpoint: !!process.env.R2_ENDPOINT,
        accessKey: !!(process.env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY),
        secretKey: !!(process.env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY)
      }
    });
    return false;
  }
}
