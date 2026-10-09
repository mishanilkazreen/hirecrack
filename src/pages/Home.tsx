interface Props {
  onStart: () => void;
}

export default function Home({ onStart }: Props) {
  return (
    <section className="page narrow home">
      <h1>HireCrack</h1>
      <p className="lead">
        Practice one-way video interviews. Answer a random question on camera and get feedback on what you
        said and how you said it.
      </p>
      <div className="row">
        <button type="button" className="btn btn-primary btn-lg" onClick={onStart}>
          Start practice
        </button>
      </div>
    </section>
  );
}
