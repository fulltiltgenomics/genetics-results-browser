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
      input = "COVID19_HGI_all";
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
            sx={{ marginBottom: "10px", width: "260px" }}
            id="filled-multiline-flexible"
            name="variantInput"
            label="Paste GRCh38 variant ids or rsids, or enter a gene"
            value={formValues.variantInput}
            multiline
            rows={10}
            variant="outlined"
            onChange={handleInputChange}
          />
          <Button
            sx={{ marginBottom: "10px", width: "260px" }}
            size="small"
            startIcon={<CreateIcon />}
            variant="contained"
            type="submit">
            <span>annotate</span>
          </Button>
          <Typography sx={{ marginBottom: "10px", width: "1000px" }}>
            Or try <br />
            {config.target === "finngen" ? (
              <>
                <Link
                  sx={{ cursor: "pointer" }}
                  onClick={() => {
                    setExampleData("FinnGen_priority");
                  }}>
                  Finnish-enriched variants (genome-wide significant in FinnGen R12 core analysis,
                  LD-pruned, &gt; 5x enriched, &lt; 1 % AF in non-Finnish Europeans)
                </Link>
                <br />
              </>
            ) : null}
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
