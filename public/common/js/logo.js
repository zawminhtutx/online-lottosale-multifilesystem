// A picked logo is shrunk before it is saved. The JSON body used to stop at 200 KB, so a
// normal photo (data URL is about a third larger than the file) was rejected and the master
// list never received a picture.

const MAX_EDGE = 256;

export function fitLogo(file) {
  if (!file) return Promise.resolve(null);
  if (file.size > 8_000_000) return Promise.reject(new Error('Logo must be under 8 MB'));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height, 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not read the logo'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const png = /png/i.test(file.type);
      const data = png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
      if (!data.startsWith('data:image/') || data.length > 500_000) {
        reject(new Error('Could not read the logo'));
        return;
      }
      resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the logo. Use a JPG or PNG.'));
    };
    img.src = url;
  });
}
