/** Lou's jokes: short, about design and code, setup first and punchline after a beat. */
export const JOKES: [string, string][] = [
  ["Why did the designer break up with the grid?", "It kept putting them in boxes."],
  ["How many developers does it take to change a light bulb?", "None. That's a hardware problem."],
  ["Why don't fonts ever win arguments?", "They always lose their weight halfway through."],
  ["I asked the CSS what was wrong.", "It said it had too many issues to float."],
  ["Why was the button so calm?", "It had a lot of padding."],
  ["What did the margin say to the padding?", "Give me some space, I'm outside your comfort zone."],
  ["Why did the hero section go to therapy?", "Too much pressure to make a first impression."],
  ["Why do designers love autumn?", "Everything finally has warm tones."],
  ["What's a monocle's favorite kind of feedback?", "Close reading."],
  ["Why did the JavaScript developer wear glasses?", "Because they couldn't C#."],
  ["I told my footer a joke.", "It said it'd get back to me at the end of the page."],
  ["Why was the color palette so confident?", "It had great contrast."],
  ["What's a kerning pair's favorite dance?", "The tight squeeze."],
  ["Why did the developer go broke?", "They used up all their cache."],
  ["Why did the website go to the doctor?", "It had a bad case of broken links."],
  ["What do you call a design system with no tokens?", "A design suggestion."],
  ["Why did the gradient leave the party?", "It couldn't decide which way to go."],
  ["How does a designer fix a broken heart?", "Command Z."],
  ["Why was the alt text so popular?", "It always described things so nicely."],
  ["What did the h1 say to the h3?", "Where's h2? You can't just skip a level."],
  ["Why did the clay figure get a job in QA?", "He's very good at picking things apart."],
  ["Why don't serifs ever get lost?", "They always have a little foot to stand on."],
  ["My code works and I don't know why.", "My code doesn't work and I don't know why. Same energy."],
  ["What's a mobile layout's least favorite sport?", "Horizontal scrolling."],
  ["Why did the developer quit the haunted house?", "Too many ghost elements."],
  ["What do you call a page with perfect spacing?", "Whitespace well spent."],
  ["Why did the token feel left out?", "Nobody used it, they hard-coded the color instead."],
  ["How do you comfort a sad stylesheet?", "Tell it it's important. But not !important."],
  ["Why did the loupe get promoted?", "It always looked closely at the details."],
  ["What's the best thing about Swiss design?", "The flag is a big plus."],
];

/** Next joke in a shuffled order that's remembered, so he doesn't repeat himself too soon. */
export function nextJoke(): [string, string] {
  let order: number[] = [];
  let at = 0;
  try {
    const saved = JSON.parse(localStorage.getItem("loupe-jokes") || "null");
    if (saved && Array.isArray(saved.order) && saved.order.length === JOKES.length) { order = saved.order; at = saved.at; }
  } catch {}
  if (!order.length || at >= order.length) {
    order = JOKES.map((_, i) => i).sort(() => Math.random() - 0.5);
    at = 0;
  }
  const joke = JOKES[order[at]];
  try { localStorage.setItem("loupe-jokes", JSON.stringify({ order, at: at + 1 })); } catch {}
  return joke;
}
