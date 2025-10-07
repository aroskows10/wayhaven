import { Redirect } from 'expo-router';


// this is the home page / defualt actions when first opening the app
export default function Page() {
  return <Redirect href={"/(drawer)/map"} />;
}
      
