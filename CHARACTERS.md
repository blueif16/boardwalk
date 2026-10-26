# Characters

Tiny animal characters (bears, bunnies, cats, dogs) that make the park feel lived in. What makes a crowd look real is
how it behaves, not how detailed it is.

## Behaviour

1. **People walk to places, in the real directions.**
   - A walking network traced on the stage: the promenade's lanes, the five beach stairs, each platform's gate, the
     stall counters, and the sand below the stairs.
   - Each walker picks a destination (a ride gate, a stall, the stairs, the beach), walks the network there, does
     something, then picks the next one. Nobody walks an endless loop.
   - Traffic flows both ways along the promenade, loosely keeping to the right.
2. **Most people are doing something in place.** Queueing, eating, sitting, watching, taking photos. Start at about one
   walker in three and tune by eye.
3. **Still people face what they are doing.** A queue faces the ride's gate; people eating face each other or their food;
   people on benches face the sea; onlookers turn their heads to follow something moving.
4. **Groups.** Couples and families walk together at one pace, a kid a little ahead; when the kid stops, the parent stops.
   Speeds vary; people pause.
5. **Density follows the attractions.** Thicker at gates, stalls and stairs, thinner at the edges. It follows the time of
   day: joggers and dog walkers in the morning, the big crowd at midday, couples at night.
6. **They sit inside the scene, not on top of it.** A small contact shadow under each one; drawn in order of their feet
   (lower on screen in front); hidden by front-layer cut-outs such as stalls, rails and the wall.

## Drawing

- **Views.** The promenade runs almost horizontally on screen, so most walking is seen from the side. Three drawn views
  (front, back, side, the side mirrored for the other direction) cover it; stairs and gates use front and back.
- **Walk.** About 30 px tall: a two-frame step or a hop with a little squash reads as walking. Turning swaps the view with
  a small hop.
- **Drawing.** Hundreds of characters as sprites from one atlas, drawn in one WebGL call. Rive only for a few featured
  characters with interactions.
- **Making them.** Two candidates, compared in the characters test:
  - shyfai character sheets in the style frame's look (risk: the views don't match each other);
  - Meshy 3D characters rendered to sprites from each direction (the views always match; qingming has the pipeline).
