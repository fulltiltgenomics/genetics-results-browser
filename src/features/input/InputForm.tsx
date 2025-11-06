import { useEffect, useState } from "react";
import { Box, Link, TextField, Typography } from "@mui/material";
import Button from "@mui/material/Button";
import CreateIcon from "@mui/icons-material/Create";
import { useDataStore } from "../../store/store";
import config from "../../config.json";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { useNavigate, useSearchParams } from "react-router-dom";

const InputForm = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [formValues, setFormValues] = useState({ variantInput: "" });
  const setVariantInput = useDataStore((state) => state.setVariantInput);
  const setMessage = useDataStore((state) => state.setMessage);
  const navigate = useNavigate();

  // form has been submitted or the url has been changed
  useEffect(() => {
    if (searchParams.get("q")) {
      const input = decompressFromEncodedURIComponent(searchParams.get("q")!);
      setFormValues({
        variantInput: input,
      });
      setVariantInput(input);
      setMessage(undefined);
    }
  }, [searchParams]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormValues({
      ...formValues,
      [name]: value,
    });
  };

  const handleSubmit = (input: string) => {
    const lz = compressToEncodedURIComponent(input);
    // 2000 is the limit for url length in many browsers, but we need some space for the rest of the url
    if (lz.length > 1900) {
      setFormValues({
        variantInput: input,
      });
      setVariantInput(input);
      setMessage(
        "The input is too long to be stored in the url. If you want to share these results, you should share your variant list instead of a direct link."
      );
      navigate("/");
    } else {
      navigate("/?q=" + lz);
    }
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handleSubmit(formValues.variantInput);
  };

  const setExampleData = (data: string) => {
    let input = "";
    if (data == "covid_severe_leads") {
      input = "COVID19_HGI_severity";
    }
    if (data == "covid_all") {
      input =
        "1-46810098-T-C\t-4.69E-02\tsev\n" +
        "1-64947147-G-T\t-8.71E-02\tsev\n" +
        "1-77483438-G-A\t7.06E-02\tsev\n" +
        "1-155162930-G-A\t-2.89E-02\tnc\n" +
        "1-155202934-T-C\t-1.95E-01\tsev\n" +
        "2-26616850-G-T\t4.76E-02\tsev\n" +
        "2-60480453-A-G\t-1.16E-01\tsev\n" +
        "3-45793925-G-A\t2.03E-01\tsusc\n" +
        "3-45818159-G-A\t7.29E-01\tsev\n" +
        "3-101647854-G-A\t-6.55E-02\tsusc\n" +
        "3-195770872-T-C\t2.65E-0\tsusc\n" +
        "4-25312372-A-G\t1.13E-01\tsev\n" +
        "4-25447603-G-A\t-8.36E-02\tsev\n" +
        "4-102267552-C-T\t1.14E-01\tsusc\n" +
        "4-105897896-G-A\t-1.02E-01\tsev\n" +
        "5-132441275-T-C\t9.06E-02\tsev\n" +
        "6-29947491-C-T\t-8.49E-02\tsev\n" +
        "6-31182658-A-G\t-1.18E-01\tsev\n" +
        "6-32714422-T-C\t-1.66E-01\tsev\n" +
        "6-33081434-C-T\t5.61E-02\tnc\n" +
        "6-41520640-G-A\t3.30E-01\tsev\n" +
        "7-22854868-T-C\t-7.12E-02\tsev\n" +
        "7-75622276-CA-C\t8.39E-02\tnc\n" +
        "7-100032719-C-T\t8.13E-02\tsev\n" +
        "8-60513412-G-A\t7.29E-02\tsev\n" +
        "9-15795835-G-T\t1.11E-01\tsev\n" +
        "9-21206606-C-G\t4.46E-01\tsev\n" +
        "9-33425186-GTAAC-G\t7.26E-02\tnc\n" +
        "9-133273813-C-T\t-9.16E-02\tsusc\n" +
        "10-79977061-G-A\t9.59E-02\tnc\n" +
        "10-112972548-C-A\t-5.37E-02\tsev\n" +
        "11-1219991-G-T\t-1.63E-01\tsev\n" +
        "11-34480495-C-T\t-1.09E-01\tsev\n" +
        "12-112922758-T-C\t8.96E-02\tsev\n" +
        "12-132565387-T-C\t-9.22E-02\tsev\n" +
        "13-112881427-C-T\t1.38E-01\tsev\n" +
        "14-28990028-A-G\t-9.45E-02\tsusc\n" +
        "16-89196249-G-A\t1.50E-01\tsev\n" +
        "17-39990289-C-G\t4.08E-02\tnc\n" +
        "17-45635098-G-A\t-1.12E-01\tsev\n" +
        "17-49863260-C-A\t2.91E-01\tsev\n" +
        "19-4717660-A-G\t2.40E-01\tsev\n" +
        "19-8896954-G-A\t2.90E-02\tsusc\n" +
        "19-10352442-G-C\t3.82E-01\tsev\n" +
        "19-45869791-ATT-A\t7.04E-02\tsev\n" +
        "19-48702888-G-C\t-8.74E-02\tsusc\n" +
        "19-50379362-T-C\t8.65E-02\tsev\n" +
        "21-33237639-A-G\t1.88E-01\tsev\n" +
        "21-33934844-G-A\t1.79E-01\tsev\n" +
        "21-41471061-G-A\t-8.59E-02\tsev\n" +
        "23-15602217-T-C\t-6.50E-01\tsusc\n";
    }
    if (data == "FinnGen_priority") {
      input = "FinnGen_enriched_202505";
    }
    handleSubmit(input);
  };

  return (
    <>
      <form onSubmit={handleFormSubmit}>
        <Box sx={{ display: "flex", flexDirection: "column", width: "260px" }}>
          <TextField
            sx={{ marginBottom: "10px", width: "360px" }}
            id="filled-multiline-flexible"
            name="variantInput"
            label="Paste GRCh38 variant ids or rsids, or enter a gene name"
            value={formValues.variantInput}
            multiline
            rows={10}
            variant="outlined"
            onChange={handleInputChange}
          />
          <Button
            sx={{ marginBottom: "10px", width: "360px" }}
            size="small"
            startIcon={<CreateIcon />}
            variant="contained"
            type="submit">
            <span>annotate</span>
          </Button>
          <Typography sx={{ marginBottom: "10px", width: "1000px" }}>
            Or try <br />
            <Link
              sx={{ cursor: "pointer" }}
              onClick={() => {
                setExampleData("FinnGen_priority");
              }}>
              Finnish-enriched variants (genome-wide significant in FinnGen R12 core analysis,
              LD-pruned, &gt; 5x enriched, &lt; 1 % AF in non-Finnish Europeans)
            </Link>
            <br />
            <Link
              sx={{ cursor: "pointer" }}
              onClick={() => {
                setExampleData("covid_severe_leads");
              }}>
              COVID-19 severity lead variants
            </Link>
            <br />
            <Link
              sx={{ cursor: "pointer" }}
              onClick={() => {
                setExampleData("covid_all");
              }}>
              COVID-19 all lead variants (with beta values and categories)
            </Link>
            <br />
          </Typography>
        </Box>
      </form>
    </>
  );
};

export default InputForm;
