"use client";
import { Flag, Route, Radio, ArrowUpRight, Mountain } from "lucide-react";
export default function RaceApp() {
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="/">
          <Route size={25} /> MILEMARK <span>RACE TRACKER</span>
        </a>
        <a className="button dark" href="/setup">
          Set up a race <ArrowUpRight size={16} />
        </a>
      </header>
      <section className="intro">
        <p className="eyebrow">YOUR RACE. YOUR ROUTE.</p>
        <h1>Every mile, together.</h1>
        <p>A live view of the trail, from the first step to the finish.</p>
      </section>
      <section className="welcome">
        <div>
          <Mountain size={40} />
          <h2>Put your next adventure on the map.</h2>
          <p>
            Upload your route, mark your aid stations, and connect your Garmin.
            One link brings your crew along.
          </p>
          <a className="button orange" href="/setup">
            Set up a race <ArrowUpRight size={18} />
          </a>
          <a className="textlink" href="/demo">
            Explore a demo race →
          </a>
          <a className="textlink" href="/replay">Replay your GPS recording →</a>
        </div>
        <aside>
          <span className="eyebrow">MADE FOR YOUR SUPPORT CREW</span>
          <article>
            <Radio />
            <div>
              <h3>Follow the effort</h3>
              <p>
                Live location, arrival estimates, and a clear signal when the
                feed is healthy.
              </p>
            </div>
          </article>
          <article>
            <Flag />
            <div>
              <h3>Be there for the next split</h3>
              <p>Every aid station and the finish, all in one place.</p>
            </div>
          </article>
        </aside>
      </section>
      <footer>
        MILEMARK <span>A little closer to the trail.</span>
      </footer>
    </main>
  );
}
