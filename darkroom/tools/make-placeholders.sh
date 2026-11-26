#!/usr/bin/env bash
# Regenerates the placeholder media in template/assets with ffmpeg (and Python + Pillow for the
# transparent letter image). Replace these files with your own photos, music and video.
set -euo pipefail
cd "$(dirname "$0")/../template/assets"
mkdir -p bg images music ambience sfx video

FONT=$(fc-match -f '%{file}' 'DejaVu Sans' 2>/dev/null || true)
label() { # draw a small "placeholder" label in the corner
  if [ -n "$FONT" ]; then echo ",drawtext=fontfile=$FONT:text='placeholder  assets/$1':x=24:y=h-40:fontsize=18:fontcolor=white@0.45"; fi
}
img() { # name, geq luminance expression
  ffmpeg -v error -y -f lavfi -i "color=c=black:s=1600x900:d=1,format=gray" \
    -vf "geq=lum='$2',noise=alls=18:allf=t,vignette=PI/4.5,format=yuv420p$(label "$1")" \
    -frames:v 1 -q:v 5 "$1"
}

# harbor: pale sky, dark horizon, rippled water
img bg/harbor.jpg 'if(lt(Y,H*0.52), 150-90*(Y/(H*0.52)), if(lt(Y,H*0.56), 12, 25+35*(1+sin(Y/2.5+3*sin(X/90)))*((Y-H*0.56)/(H*0.44))*exp(-pow((X-W*0.62)/(W*0.12),2))+12))'
# alley: light at the far end of a narrow street
img bg/alley.jpg '18+200*exp(-pow((X-W/2)/(W*0.035+W*0.25*(Y/H-0.5)*(Y/H-0.5)),2))*(0.4+0.6*Y/H)'
# rooftop: rain-white sky over a black skyline with lit windows
img bg/rooftop.jpg 'if(lt(Y,H*(0.42+0.22*abs(sin(floor(X/85)*1.7)))), 200-110*(Y/H), if(lt(mod(X,85),12)+lt(mod(Y,40),18), 8, if(gt(sin(floor(X/30)*7.1+floor(Y/40)*3.3),0.7), 170, 10)))'
# title: fog with a single light
img bg/title.jpg '30+150*exp(-(pow((X-W*0.5)/(W*0.22),2)+pow((Y-H*0.42)/(H*0.3),2)))'

# letter: an old note with a transparent background
python3 - <<'PY'
from PIL import Image, ImageDraw, ImageFilter
im = Image.new('RGBA', (900, 620), (0, 0, 0, 0))
paper = Image.new('RGBA', (820, 540), (226, 219, 204, 255))
d = ImageDraw.Draw(paper)
for y in range(90, 500, 46):
    d.line([(70, y), (760, y)], fill=(150, 140, 125, 255), width=2)
for i, y in enumerate(range(80, 470, 46)):
    w = 520 + (i * 97) % 200
    d.line([(80, y), (80 + w, y - 4)], fill=(40, 40, 50, 255), width=4)
paper = paper.rotate(-3, expand=True, resample=Image.BICUBIC)
shadow = Image.new('RGBA', paper.size, (0, 0, 0, 160))
shadow.putalpha(paper.split()[3].point(lambda a: 140 if a else 0))
im.paste(shadow.filter(ImageFilter.GaussianBlur(12)), (40, 46), shadow.filter(ImageFilter.GaussianBlur(12)))
im.alpha_composite(paper, (24, 20))
im.save('images/letter.png', optimize=True)
PY

# theme: a slow A-minor drone that loops cleanly every 24 s
ffmpeg -v error -y -f lavfi -i "aevalsrc='0.16*sin(2*PI*110*t)*(0.6+0.4*sin(2*PI*t/4))+0.09*sin(2*PI*165*t)*(0.5+0.5*sin(2*PI*t/6))+0.07*sin(2*PI*131*t)*(0.5-0.5*cos(2*PI*t/8))+0.05*sin(2*PI*220*t)*(0.5+0.5*sin(2*PI*t/3))':s=44100:d=24" \
  -af "lowpass=f=1800" -c:a aac -b:a 64k music/theme.m4a
# rain
ffmpeg -v error -y -f lavfi -i "anoisesrc=color=pink:amplitude=0.25:d=12:r=44100" -af "highpass=f=400,lowpass=f=7000,afade=t=in:d=0.3" -c:a aac -b:a 64k ambience/rain.m4a
# door: a heavy thud
ffmpeg -v error -y -f lavfi -i "aevalsrc='0.9*sin(2*PI*55*t)*exp(-7*t)+0.4*sin(2*PI*90*t)*exp(-12*t)':s=44100:d=1.2" -c:a aac -b:a 64k sfx/door.m4a
# intro: a tram light passing in the dark, with a low hum
ffmpeg -v error -y -f lavfi -i "color=c=black:s=640x360:d=5:r=24,format=gray" \
  -f lavfi -i "aevalsrc='0.25*sin(2*PI*70*t)*min(1,t)*min(1,5-t)':s=44100:d=5" \
  -vf "geq=lum='10+230*exp(-pow((X-W*(T/4-0.1))/40,2))*exp(-pow((Y-H*0.58)/14,2))+60*exp(-pow((X-W*(T/4-0.1))/160,2))*exp(-pow((Y-H*0.6)/70,2))',noise=alls=14:allf=t,format=yuv420p" \
  -c:v libx264 -crf 30 -preset slow -c:a aac -b:a 64k -shortest -movflags +faststart video/intro.mp4

du -ch bg/* images/* music/* ambience/* sfx/* video/* | tail -1
