#!/usr/bin/env python3
"""Assign an existing hero image to each post in a content plan, and rewrite the
post's image_alt so it describes the picture that will actually be shown.

Why this exists: the writing agents produce an `image_prompt` and an `image_alt`
describing an image nobody is going to generate. Shipping that alt text would put
a false description on the page — bad for accessibility, and a small lie in the
markup. So each post is mapped to one of the photographs already in the repo, and
its alt text is replaced with one built from what that photograph actually shows.

Images repeat across posts within a cluster. That is the accepted trade-off of
reusing a 61-image pool across 60 new posts; the mapping below spreads them as
widely as the subject matter allows rather than defaulting everything to one shot.

Deliberately excluded from the pool:
  hydrafacial-treatment-explained-benefits-process-amp-results
    — has "HydraFacial is a medical-grade facial ... with no downtime" set into
      the picture: an unlicensed trademark plus an absolute claim.

Usage:
    python3 scripts/assign_images.py --plan data/content-plan-60.json --dry-run
    python3 scripts/assign_images.py --plan data/content-plan-60.json
"""
import argparse, json, os, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG  = os.path.join(ROOT, 'images', 'blog')
SRC  = os.path.join(ROOT, 'blog-source')

BANNED = {'hydrafacial-treatment-explained-benefits-process-amp-results'}

# What each usable photograph actually depicts, in a form that can be dropped
# into an alt sentence. Written from the images themselves / their original alt.
SHOWS = {
 'does-laser-hair-removal-cause-cancer':      'A diode laser hair removal handpiece and protective eyewear on a clinic treatment bed',
 'laser-hair-removal-how-many-sessions-science':'A laser hair removal treatment bed with the handpiece resting on it',
 'laser-hair-removal-side-effects-by-skin-type':'A diode laser handpiece and cooling gel on a clinic treatment bed',
 'is-laser-hair-removal-painful-pain-scores': 'A laser handpiece with a cooling tip beside topical anaesthetic cream on a treatment bed',
 'laser-hair-removal-regrowth-after-pregnancy-hormonal-change':'A laser hair removal handpiece on a clinic treatment bed',
 'laser-hair-removal-vs-ipl-at-home-science': 'A professional diode laser handpiece beside a compact at-home IPL device',
 'underarm-laser-whitening-evidence':         'Two different laser handpieces side by side on a clinic treatment bed',
 'laser-hair-removal-and-pregnancy-safety':   'A calm, empty aesthetic clinic treatment room in warm beige tones',
 'pcos-hirsutism-hair-growth-evidence':       'A clinical chart and a laser hair removal handpiece on a consultation desk',
 'fitzpatrick-skin-type-indian-skin-laser-safety':'A skin-tone reference chart and a colorimeter on a clinic desk',
 'tattoo-removal-how-many-sessions-science':  'A Q-switched laser handpiece positioned over a fading tattoo',
 'carbon-laser-facial-science-explained':     'Carbon lotion and a Q-switched Nd:YAG laser handpiece on a clinic tray',

 'post-inflammatory-hyperpigmentation-acne-treatment-ladder':"A dermatoscope and skincare ampoules on a clinic tray",
 'can-melasma-be-cured-permanently':          'A dermatology assessment chart and sunscreen on a clinic counter',
 'melasma-in-pregnancy-chloasma':             'A skincare shelf with broad-spectrum sunscreen in a clinic setting',
 'sunscreen-for-indian-skin-spf-guide':       'Tinted mineral sunscreen and a UV reference card on a clinic desk',
 'skin-whitening-injections-safety-data':     'A vial and syringe on a clinical tray',
 'what-deficiency-causes-dark-circles':       "Iron-rich foods and a dermatologist's loupe on a clinic counter",

 'chemical-peel-purging-vs-breakout':         'Chemical peel solution and an applicator brush on a clinic treatment tray',
 'how-dermatologists-evaluate-evidence-guide':'An open medical research journal and a magnifying glass on a clinic desk',

 'cryolipolysis-safety-fda-clinical-data':    'A cryolipolysis fat-freezing applicator on a treatment bed beside a consent form',
 'fat-freeze-results-1-month-timeline':       'A cryolipolysis applicator on a treatment bed beside a calendar',
 'hifem-body-toning-evidence':                'A HIFEM electromagnetic muscle toning applicator on a clinic treatment bed',

 'is-hifu-safe-clinical-evidence':            'A HIFU ultrasound handpiece and transducer on a clinic treatment bed',
 'hifu-vs-botox-evidence-comparison':         'A HIFU ultrasound handpiece and an injection tray side by side',
 'mnrf-microneedling-rf-collagen-research':   'A radiofrequency microneedling handpiece on a sterile clinic tray',

 'hair-prp-for-hair-fall-evidence':           'A centrifuged platelet-rich plasma vial and a sterile injection tray',
 'pcos-hair-loss-evidence-based-guide':       'A trichoscope and a hairbrush on a clinic consultation desk',

 'hydra-facial-price-in-india-what-it-actually-costs':'A skin-assessment form and a sealed serum vial on a clinic counter',
 'hydrafacial-side-effects-who-should-avoid': 'A skin-assessment clipboard and a serum vial on a clinic counter',
}

# slug -> image. Ordered so repeats within a cluster are spread across the
# available props rather than all landing on one photograph.
ASSIGN = {
 # ── Laser hair removal (21 posts, 9 laser images + 3 adjacent) ──
 'laser-hair-removal-cost-india-full-breakdown':      'laser-hair-removal-how-many-sessions-science',
 'full-body-laser-hair-removal-cost-what-you-get':    'laser-hair-removal-and-pregnancy-safety',
 'permanent-laser-hair-removal-cost-is-it-permanent': 'laser-hair-removal-regrowth-after-pregnancy-hormonal-change',
 'underarm-laser-hair-removal-cost-sessions':         'underarm-laser-whitening-evidence',
 'laser-hair-removal-burns-causes-prevention':        'laser-hair-removal-side-effects-by-skin-type',
 'bikini-laser-hair-removal-what-to-expect':          'is-laser-hair-removal-painful-pain-scores',
 'bikini-laser-hair-removal-cost-india':              'laser-hair-removal-and-pregnancy-safety',
 'diode-laser-hair-removal-how-it-works':             'does-laser-hair-removal-cause-cancer',
 'ipl-vs-laser-hair-removal-difference':              'laser-hair-removal-vs-ipl-at-home-science',
 'laser-hair-removal-machine-types-explained':        'underarm-laser-whitening-evidence',
 'laser-hair-removal-for-men-what-differs':           'laser-hair-removal-how-many-sessions-science',
 'upper-lip-laser-hair-removal-cost-safety':          'is-laser-hair-removal-painful-pain-scores',
 'face-laser-hair-removal-cost-india':                'laser-hair-removal-side-effects-by-skin-type',
 'laser-hair-removal-at-home-vs-clinic':              'laser-hair-removal-vs-ipl-at-home-science',
 'laser-hair-removal-cost-mumbai-2026':               'laser-hair-removal-and-pregnancy-safety',
 'laser-hair-removal-hormonal-conditions':            'pcos-hirsutism-hair-growth-evidence',
 'laser-hair-removal-tattoo-moles-safety':            'tattoo-removal-how-many-sessions-science',
 'laser-hair-removal-skin-lightening-myth':           'fitzpatrick-skin-type-indian-skin-laser-safety',
 'laser-hair-removal-maintenance-after-course':       'laser-hair-removal-regrowth-after-pregnancy-hormonal-change',
 'laser-hair-removal-vs-electrolysis':                'does-laser-hair-removal-cause-cancer',
 'laser-hair-removal-summer-vs-monsoon-mumbai':       'laser-hair-removal-how-many-sessions-science',

 # ── Pigmentation / melasma (8) ──
 'open-pores-treatment-what-works':                   'mnrf-microneedling-rf-collagen-research',
 'lip-pigmentation-treatment-causes':                 'post-inflammatory-hyperpigmentation-acne-treatment-ladder',
 'best-treatment-for-melasma-on-face':                'can-melasma-be-cured-permanently',
 'pigmentation-around-mouth-causes':                  'skin-whitening-injections-safety-data',
 'tan-removal-treatment-vs-home-remedies':            'sunscreen-for-indian-skin-spf-guide',
 'underarm-darkness-causes-treatment':                'underarm-laser-whitening-evidence',
 'neck-pigmentation-acanthosis-nigricans':            'what-deficiency-causes-dark-circles',
 'sun-spots-vs-melasma-vs-pih':                       'fitzpatrick-skin-type-indian-skin-laser-safety',

 # ── Acne + scars (6) ──
 'types-of-acne-scars-and-treatment':                 'post-inflammatory-hyperpigmentation-acne-treatment-ladder',
 'acne-scar-treatment-cost-india':                    'mnrf-microneedling-rf-collagen-research',
 'subcision-for-rolling-scars-evidence':              'how-dermatologists-evaluate-evidence-guide',
 'microneedling-vs-laser-acne-scars':                 'carbon-laser-facial-science-explained',
 'back-acne-body-acne-treatment':                     'chemical-peel-purging-vs-breakout',
 'hormonal-acne-adult-women-india':                   'pcos-hair-loss-evidence-based-guide',

 # ── Ageing / HIFU / dark circles (5) ──
 'skin-tightening-treatment-options-compared':        'is-hifu-safe-clinical-evidence',
 'hifu-cost-india-sessions':                          'hifu-vs-botox-evidence-comparison',
 'thread-lift-vs-hifu-vs-fillers':                    'hifu-vs-botox-evidence-comparison',
 'collagen-loss-by-age-indian-skin':                  'mnrf-microneedling-rf-collagen-research',
 'under-eye-hollows-vs-dark-circles':                 'what-deficiency-causes-dark-circles',

 # ── Body contouring (5) ──
 'fat-freeze-cost-india-per-area':                    'cryolipolysis-safety-fda-clinical-data',
 'double-chin-reduction-options':                     'fat-freeze-results-1-month-timeline',
 'stretch-marks-treatment-what-works':                'mnrf-microneedling-rf-collagen-research',
 'cellulite-treatment-evidence-review':               'hifem-body-toning-evidence',
 'inch-loss-vs-fat-loss-difference':                  'cryolipolysis-safety-fda-clinical-data',

 # ── Peels / skin science / bridal (5) ──
 'chemical-peel-cost-india-types':                    'chemical-peel-purging-vs-breakout',
 'glass-skin-treatment-what-is-achievable':           'hydra-facial-price-in-india-what-it-actually-costs',
 'bridal-skin-treatment-timeline':                    'can-melasma-be-cured-permanently',
 'salicylic-vs-glycolic-vs-mandelic':                 'chemical-peel-purging-vs-breakout',
 'dermatologist-vs-salon-facial':                     'hydrafacial-side-effects-who-should-avoid',

 # ── Hair (4) ──
 'hair-fall-vs-hair-loss-when-to-worry':              'pcos-hair-loss-evidence-based-guide',
 'female-pattern-hair-loss-india':                    'pcos-hair-loss-evidence-based-guide',
 'prp-vs-gfc-vs-minoxidil':                           'hair-prp-for-hair-fall-evidence',
 'hair-transplant-vs-prp-when':                       'hair-prp-for-hair-fall-evidence',

 # ── Hindi (6) ──
 'pigmentation-meaning-in-hindi-guide':               'post-inflammatory-hyperpigmentation-acne-treatment-ladder',
 'hair-fall-kaise-roke-evidence':                     'hair-prp-for-hair-fall-evidence',
 'laser-hair-removal-hindi-guide':                    'does-laser-hair-removal-cause-cancer',
 'melasma-hindi-jhaiyan-treatment':                   'melasma-in-pregnancy-chloasma',
 'open-pores-hindi-treatment':                        'mnrf-microneedling-rf-collagen-research',
 'acne-scars-hindi-treatment':                        'carbon-laser-facial-science-explained',
}

# Hindi posts need Hindi alt text; the English sentence would be wrong on the page.
HINDI_ALT = {
 'pigmentation-meaning-in-hindi-guide':
   'क्लिनिक ट्रे पर डर्मेटोस्कोप और स्किनकेयर एम्प्यूल — पिगमेंटेशन के इलाज की जानकारी',
 'hair-fall-kaise-roke-evidence':
   'क्लिनिक में सेंट्रीफ्यूज्ड पीआरपी वायल और स्टेराइल इंजेक्शन ट्रे — हेयर फॉल के इलाज की जानकारी',
 'laser-hair-removal-hindi-guide':
   'क्लिनिक ट्रीटमेंट बेड पर डायोड लेज़र हेयर रिमूवल हैंडपीस और सुरक्षा चश्मा',
 'melasma-hindi-jhaiyan-treatment':
   'क्लिनिक में ब्रॉड-स्पेक्ट्रम सनस्क्रीन की शेल्फ — झाइयों (मेलास्मा) की देखभाल',
 'open-pores-hindi-treatment':
   'स्टेराइल क्लिनिक ट्रे पर रेडियोफ्रीक्वेंसी माइक्रोनीडलिंग हैंडपीस — खुले रोमछिद्रों का इलाज',
 'acne-scars-hindi-treatment':
   'क्लिनिक ट्रे पर कार्बन लोशन और क्यू-स्विच्ड लेज़र हैंडपीस — मुंहासों के दाग का इलाज',
}


def build_alt(post_slug, img, angle):
    if post_slug in HINDI_ALT:
        return HINDI_ALT[post_slug]
    shows = SHOWS.get(img)
    if not shows:
        return None
    return '%s, illustrating %s' % (shows, angle[0].lower() + angle[1:])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plan', required=True)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    topics = json.load(open(a.plan, encoding='utf-8'))['topics']
    problems, done = [], []
    use = collections.Counter()

    for t in topics:
        slug = t['slug']
        img = ASSIGN.get(slug)
        if not img:
            problems.append('%s: no image assigned' % slug); continue
        if img in BANNED:
            problems.append('%s: assigned a banned image (%s)' % (slug, img)); continue
        if not os.path.exists(os.path.join(IMG, img + '.jpg')):
            problems.append('%s: source image missing (%s.jpg)' % (slug, img)); continue
        alt = build_alt(slug, img, t['angle'])
        if not alt:
            problems.append('%s: no description recorded for %s' % (slug, img)); continue

        use[img] += 1
        src_json = os.path.join(SRC, slug + '.json')
        if not os.path.exists(src_json):
            problems.append('%s: post not written yet' % slug); continue

        if not a.dry_run:
            # No file copy. The renderer and the blog-index card both read
            # `image_source`, so the post points at the original photograph.
            # Copying produced 120 byte-identical files (~7.6 MB) and meant a
            # future image fix would have to be applied in N places.
            d = json.load(open(src_json, encoding='utf-8'))
            d['image_alt'] = alt
            d['image_source'] = img          # provenance, so reuse is never a mystery later
            json.dump(d, open(src_json, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
            open(src_json, 'a', encoding='utf-8').write('\n')
        done.append((slug, img, alt))

    print('assigned: %d   problems: %d' % (len(done), len(problems)))
    print()
    print('=== reuse spread ===')
    for img, n in use.most_common():
        print('  %-56s x%d' % (img[:56], n))
    print('  distinct images used: %d of %d in pool' % (len(use), len(SHOWS)))
    if problems:
        print()
        print('=== problems ===')
        for p in problems: print('  ' + p)
    if a.dry_run:
        print()
        print('[dry-run] no files copied, no JSON written.')
    return 1 if problems and not a.dry_run else 0


if __name__ == '__main__':
    sys.exit(main())
