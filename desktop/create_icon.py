from PIL import Image, ImageDraw, ImageFilter

size = 512
image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
g = ImageDraw.Draw(glow)
g.ellipse((70, 100, 450, 430), fill=(110, 94, 255, 92))
image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(45)))
d = ImageDraw.Draw(image)
d.rounded_rectangle((22, 22, 490, 490), radius=112, fill=(24, 31, 51, 255), outline=(117, 112, 228, 255), width=8)
d.rounded_rectangle((80, 187, 432, 356), radius=70, fill=(229, 230, 247, 255))
d.rounded_rectangle((104, 203, 408, 326), radius=55, fill=(44, 55, 88, 255))
d.rounded_rectangle((120, 213, 393, 310), radius=45, fill=(12, 19, 36, 255))
d.arc((153, 228, 362, 321), 200, 336, fill=(151, 137, 255, 255), width=12)
d.rounded_rectangle((44, 228, 98, 293), radius=20, fill=(151, 137, 255, 255))
d.rounded_rectangle((414, 228, 468, 293), radius=20, fill=(151, 137, 255, 255))
d.rounded_rectangle((187, 335, 325, 372), radius=17, fill=(186, 189, 218, 255))
image.save('desktop/icon.ico', format='ICO', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
