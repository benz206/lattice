"""Generate a small synthetic PDF corpus with planted facts for evaluation.

Each ``PlantedFact`` is embedded in a distinct page so that retrieval has a
clear ground-truth page for its corresponding question. Filler text around the
planted sentence padding the document to a realistic size.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import fitz


@dataclass(frozen=True)
class PlantedFact:
    """One question/answer pair anchored to a specific page of a document."""

    question: str
    answer_sentence: str
    page: int
    expected_keywords: tuple[str, ...] = ()


@dataclass(frozen=True)
class CorpusDocument:
    """A generated PDF and the facts planted inside it."""

    filename: str
    path: Path
    facts: tuple[PlantedFact, ...]


_FILLER_LINES = [
    "This section provides background context for the material that follows.",
    "The text expands on earlier definitions without introducing new facts.",
    "Readers already familiar with the topic may skim this passage safely.",
    "Supporting examples are deferred to the appendices at the end of the volume.",
    "Terminology throughout follows the conventions established in chapter one.",
    "Related work in adjacent disciplines is surveyed only briefly here.",
    "The remainder of the page restates the main argument in slightly different words.",
    "Illustrations are omitted from this edition to keep the layout compact.",
    "Historical notes on the subject appear at the end of this section.",
    "The present discussion assumes a working knowledge of the prerequisites.",
]


def _page_body(fact: PlantedFact, page_number: int) -> str:
    lines: list[str] = [
        f"Section {page_number}. Research notes, page {page_number}.",
        "",
    ]
    for i, filler in enumerate(_FILLER_LINES[:6]):
        lines.append(f"{i + 1}. {filler}")
    lines.append("")
    lines.append(fact.answer_sentence)
    lines.append("")
    for i, filler in enumerate(_FILLER_LINES[6:]):
        lines.append(f"{i + 7}. {filler}")
    return "\n".join(lines)


def _write_pdf(path: Path, page_texts: list[str]) -> None:
    doc = fitz.open()
    try:
        for text in page_texts:
            page = doc.new_page()
            y = 72.0
            for line in text.splitlines():
                page.insert_text((72, y), line, fontsize=11)
                y += 14.0
                if y > 760:
                    break
        doc.save(str(path))
    finally:
        doc.close()


def _doc_one_facts() -> tuple[PlantedFact, ...]:
    return (
        PlantedFact(
            question="What is the boiling point of xenorium under standard conditions?",
            answer_sentence=(
                "Xenorium has a boiling point of 742 degrees Celsius at one atmosphere "
                "of pressure, as measured in the 1998 calorimetric survey."
            ),
            page=3,
            expected_keywords=("xenorium", "boiling", "742"),
        ),
        PlantedFact(
            question="Who discovered the Fenton-Marsh isomerism rule?",
            answer_sentence=(
                "The Fenton-Marsh isomerism rule was discovered by Adelaide Fenton and "
                "Rupert Marsh in 1962 at the Cavendish Institute."
            ),
            page=7,
            expected_keywords=("Fenton-Marsh", "isomerism", "Adelaide"),
        ),
        PlantedFact(
            question="What is the diameter of the Kepler-3841b exoplanet?",
            answer_sentence=(
                "Kepler-3841b has a measured diameter of 17,420 kilometers, roughly "
                "1.36 times the diameter of Earth."
            ),
            page=11,
            expected_keywords=("Kepler-3841b", "diameter", "17,420"),
        ),
        PlantedFact(
            question="When did the Meridian Tariff Act take effect?",
            answer_sentence=(
                "The Meridian Tariff Act took effect on March 14, 1884, following "
                "ratification by the seven founding provinces."
            ),
            page=15,
            expected_keywords=("Meridian", "Tariff", "1884"),
        ),
    )


def _doc_two_facts() -> tuple[PlantedFact, ...]:
    return (
        PlantedFact(
            question="What language did the Qarnatic scribes use for legal codices?",
            answer_sentence=(
                "Qarnatic scribes drafted their legal codices in Old Veltric, a "
                "liturgical dialect retained for formal instruments long after its "
                "vernacular use had lapsed."
            ),
            page=4,
            expected_keywords=("Qarnatic", "Veltric", "codices"),
        ),
        PlantedFact(
            question="What is the resonant frequency of the Halberd-II ion trap?",
            answer_sentence=(
                "The Halberd-II ion trap operates at a resonant frequency of 13.6 "
                "megahertz when cooled below 4 kelvin."
            ),
            page=8,
            expected_keywords=("Halberd-II", "resonant", "13.6"),
        ),
        PlantedFact(
            question="Which treaty ended the Third Selenite Conflict?",
            answer_sentence=(
                "The Third Selenite Conflict ended with the Treaty of Orinoque, "
                "signed on January 2, 1773."
            ),
            page=13,
            expected_keywords=("Selenite", "Orinoque", "1773"),
        ),
    )


def build_sample_corpus(out_dir: Path) -> list[CorpusDocument]:
    """Generate a 2-document synthetic corpus with planted facts.

    Each document is padded to ~20 pages so hybrid retrieval has to actually
    discriminate between many chunks.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    documents: list[CorpusDocument] = []
    for name, facts, total_pages in (
        ("doc_alpha.pdf", _doc_one_facts(), 20),
        ("doc_beta.pdf", _doc_two_facts(), 18),
    ):
        fact_by_page = {f.page: f for f in facts}
        pages: list[str] = []
        for page_no in range(1, total_pages + 1):
            fact = fact_by_page.get(page_no)
            if fact is not None:
                pages.append(_page_body(fact, page_no))
            else:
                filler_text = "\n".join(
                    f"{i + 1}. {line}" for i, line in enumerate(_FILLER_LINES)
                )
                pages.append(
                    f"Section {page_no}. Research notes, page {page_no}.\n\n"
                    f"{filler_text}"
                )
        path = out_dir / name
        _write_pdf(path, pages)
        documents.append(CorpusDocument(filename=name, path=path, facts=facts))

    return documents


__all__ = ["PlantedFact", "CorpusDocument", "build_sample_corpus"]
