# Feedpaper

I made this prototype to explore a calmer way to read information feeds.
I get a lot of value from seeing other people's work and thoughts on Twitter, but
it's also noisy and addictive.

How Feedpaper improves the experience:

1. By default, it only shows you Tweets from yesterday. This is biggest improvement for me. I can just check it once a day, and there's no incentive to check multiple times because the list won't change until tomorrow.
2. It groups related Tweets and conversations so they're next to each other in the feed. This makes it easier to read, since there's less context switching and lets you quickly skip ahead if a topic isn't interesting.
3. Downranks and filters out low relevance and low quality Tweets based on your interests.

#### Demo
[
![6b8d2810a8c44581bc6d0c01bfc12779-with-play](https://user-images.githubusercontent.com/331454/232874792-d183e67b-f3f4-4a45-87b0-13752e6a387f.gif)
](https://www.loom.com/share/6b8d2810a8c44581bc6d0c01bfc12779)

## Intended audience

This is not intended to be a Twitter client, that would most likely be against Twitter's terms of use. I'm open sourcing it so other developers can experiment with different ways to present feeds of information. Some ideas to explore:

- Pull in items from multiple different sources (e.g. newsletters, Reddit, etc).
- Improve the ranking and relevance mechanisms (e.g. by inferring interests and anti-interests, by creating better heuristics for influencer spam, by better merging related items).
- Summarize the feed to create a personalized daily briefing.
- Explore alternate UIs, going beyond a linear feed.

## Development

Instructions coming soon...

## How it works

The code is split into two parts:

- `/app`: this is an Electron app which does the following:
  - Every 30 minutes, loads Twitter and saves the tweets from the "For You" and "Following" tabs. See `app/src/main/main.ts`.
  - The tweets are saved in a local SQLite database. See `app/src/main/db.ts`.
  - If an OpenAI API key is set, it runs an enrichment process on each new tweet to extract entities and score its relevance. See `app/src/main/enrichItems.ts`.
  - Provides access to the database via a server (http://localhost:2345), which the client (see below) uses. See `app/src/main/server.ts`.
- `/client`: this is a Next.js frontend which is where the UI lives.
  - In development, you can access it at http://localhost:2346
